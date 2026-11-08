import Foundation
import CoreBluetooth
import ExternalAccessory

/* Bluetooth receipt printers, two kinds.

   Bluetooth LE — the portable and budget printers (Xprinter, Rongta, MUNBYN,
   the "PT-210" and "MTP-II" family). They expose a GATT service with a
   characteristic that takes raw ESC/POS bytes; which service it is differs
   by maker, so instead of a list that would always be one model short this
   connects, finds the first characteristic it is allowed to write to, and
   writes there, a packet at a time.

   Bluetooth Classic through Apple's MFi programme — Epson TM-m30 and TM-P
   series, Star mC-Print and SM series. iOS only lets an app talk to those
   through ExternalAccessory, and only under the protocol names declared in
   Info.plist (`UISupportedExternalAccessoryProtocols`). They are paired in
   iPhone Settings → Bluetooth, or from the picker `pickAccessory` opens, and
   then appear in `accessories`. A Star printer must be in its ESC/POS
   emulation mode, since what is sent is ESC/POS.

   Either way the bytes are the register's (`src/print/escpos.js`); nothing
   about the receipt is decided here. */

let MFI_PROTOCOLS = ["com.epson.escpos", "jp.star-m.starpro"]

/* The print channels makers actually use, tried first: the 18F0 service most
   budget printers share, the Feasycom and Microchip (ISSC) serial bridges,
   and the FFxx serial profiles. A writable characteristic anywhere else is
   used only if none of these exists — and never one in a firmware-update
   service, which a stream of receipt bytes has no business being sent to. */
let PRINT_CHARACTERISTICS = [
    "2AF1", "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F", "49535343-8841-43F4-A8D4-ECBE34729BB3",
    "FF02", "FFE1", "FFF2", "FFF1",
].map { CBUUID(string: $0) }
let NEVER_WRITE_SERVICES = ["FE59", "1D14D6EE-FD63-4FA1-BFA4-8F47B42119F0", "00060000-F8CE-11E4-ABF4-0002A5D5C51B"].map { CBUUID(string: $0) }

final class BluetoothPrinters: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let queue = DispatchQueue(label: "ae.puremargin.bluetooth")
    private var central: CBCentralManager!
    private var onPowered: [(Bool) -> Void] = []

    private var scanFound: [UUID: CBPeripheral] = [:]
    private var known: [UUID: CBPeripheral] = [:]

    // One job at a time; the register prints one receipt at a time anyway.
    private var job: Job?

    private final class Job {
        let peripheral: CBPeripheral
        let data: Data
        let done: (String?) -> Void
        var characteristic: CBCharacteristic?
        var servicesLeft = 0
        var offset = 0
        var finished = false
        init(peripheral: CBPeripheral, data: Data, done: @escaping (String?) -> Void) {
            self.peripheral = peripheral
            self.data = data
            self.done = done
        }
    }

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: true])
    }

    // MARK: Power

    private func whenPowered(_ go: @escaping (Bool) -> Void) {
        queue.async {
            switch self.central.state {
            case .poweredOn: go(true)
            case .unknown, .resetting: self.onPowered.append(go)
            default: go(false)
            }
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state != .unknown && central.state != .resetting else { return }
        let waiting = onPowered
        onPowered = []
        waiting.forEach { $0(central.state == .poweredOn) }
    }

    // MARK: Finding printers

    func scan(timeout: Double, done: @escaping ([[String: Any]], String?) -> Void) {
        whenPowered { on in
            guard on else { done([], "Bluetooth is off or not allowed for this app."); return }
            self.scanFound = [:]
            self.central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            self.queue.asyncAfter(deadline: .now() + timeout) {
                self.central.stopScan()
                let list = self.scanFound.values
                    .filter { ($0.name ?? "").isEmpty == false }
                    .map { ["id": $0.identifier.uuidString, "name": $0.name ?? "", "kind": "ble"] as [String: Any] }
                done(list, nil)
            }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        scanFound[peripheral.identifier] = peripheral
        known[peripheral.identifier] = peripheral
    }

    // MARK: Printing over LE

    func send(id: String, data: Data, done: @escaping (String?) -> Void) {
        whenPowered { on in
            guard on else { done("Bluetooth is off or not allowed for this app."); return }
            guard self.job == nil else { done("The printer is busy with another job."); return }
            guard let uuid = UUID(uuidString: id) else { done("Unknown printer."); return }
            let peripheral = self.known[uuid] ?? self.central.retrievePeripherals(withIdentifiers: [uuid]).first
            guard let peripheral = peripheral else { done("The printer was not found. Turn it on and find it again."); return }
            self.known[uuid] = peripheral

            let job = Job(peripheral: peripheral, data: data, done: done)
            self.job = job
            peripheral.delegate = self
            if peripheral.state == .connected {
                peripheral.discoverServices(nil)
            } else {
                self.central.connect(peripheral, options: nil)
            }
            self.queue.asyncAfter(deadline: .now() + 30) { [weak job] in
                if let job = job, !job.finished { self.finish(job, "The printer did not answer.") }
            }
        }
    }

    private func finish(_ job: Job, _ error: String?) {
        guard !job.finished else { return }
        job.finished = true
        if self.job === job { self.job = nil }
        // A moment for the printer to take the last packet before letting go.
        queue.asyncAfter(deadline: .now() + 0.5) {
            self.central.cancelPeripheralConnection(job.peripheral)
        }
        job.done(error)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if let job = job, job.peripheral === peripheral { finish(job, error?.localizedDescription ?? "Could not connect to the printer.") }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let job = job, job.peripheral === peripheral else { return }
        let services = peripheral.services ?? []
        if let error = error { finish(job, error.localizedDescription); return }
        if services.isEmpty { finish(job, "This Bluetooth device is not a printer."); return }
        job.servicesLeft = services.count
        services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let job = job, job.peripheral === peripheral, job.characteristic == nil else { return }
        job.servicesLeft -= 1
        guard job.servicesLeft <= 0 else { return }

        // Every service has answered: choose where to write.
        let candidates = (peripheral.services ?? [])
            .filter { !NEVER_WRITE_SERVICES.contains($0.uuid) }
            .flatMap { $0.characteristics ?? [] }
            .filter { $0.properties.contains(.writeWithoutResponse) || $0.properties.contains(.write) }
        let chosen = candidates.first { PRINT_CHARACTERISTICS.contains($0.uuid) } ?? candidates.first
        guard let characteristic = chosen else {
            finish(job, "This Bluetooth device does not accept print jobs.")
            return
        }
        job.characteristic = characteristic
        pump(job)
    }

    private func pump(_ job: Job) {
        guard let characteristic = job.characteristic, !job.finished else { return }
        let fast = characteristic.properties.contains(.writeWithoutResponse)
        let type: CBCharacteristicWriteType = fast ? .withoutResponse : .withResponse
        let size = max(20, min(180, job.peripheral.maximumWriteValueLength(for: type)))

        if fast {
            while job.offset < job.data.count && job.peripheral.canSendWriteWithoutResponse {
                let end = min(job.offset + size, job.data.count)
                job.peripheral.writeValue(job.data.subdata(in: job.offset..<end), for: characteristic, type: .withoutResponse)
                job.offset = end
            }
            if job.offset >= job.data.count { finish(job, nil) }
            // Otherwise `peripheralIsReady` calls back when there is room again.
        } else {
            if job.offset >= job.data.count { finish(job, nil); return }
            let end = min(job.offset + size, job.data.count)
            job.peripheral.writeValue(job.data.subdata(in: job.offset..<end), for: characteristic, type: .withResponse)
            job.offset = end
            // `didWriteValueFor` calls back for the next packet.
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        if let job = job, job.peripheral === peripheral { pump(job) }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let job = job, job.peripheral === peripheral else { return }
        if let error = error { finish(job, error.localizedDescription); return }
        pump(job)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if let job = job, job.peripheral === peripheral, !job.finished {
            finish(job, error?.localizedDescription ?? "The printer disconnected.")
        }
    }

    // MARK: MFi printers (Epson, Star)

    func accessories() -> [[String: Any]] {
        EAAccessoryManager.shared().connectedAccessories.compactMap { accessory in
            guard let proto = accessory.protocolStrings.first(where: { MFI_PROTOCOLS.contains($0) }) else { return nil }
            return [
                "id": accessory.serialNumber.isEmpty ? "\(accessory.connectionID)" : accessory.serialNumber,
                "name": accessory.name,
                "kind": "mfi",
                "protocol": proto,
            ]
        }
    }

    func pickAccessory(done: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            EAAccessoryManager.shared().showBluetoothAccessoryPicker(withNameFilter: nil) { error in
                if let error = error as? EABluetoothAccessoryPickerError, error.code == .alreadyConnected { done(nil); return }
                if let error = error as? EABluetoothAccessoryPickerError, error.code == .resultCancelled { done("cancelled"); return }
                done(error?.localizedDescription)
            }
        }
    }

    func sendAccessory(id: String, proto: String, data: Data, done: @escaping (String?) -> Void) {
        let accessory = EAAccessoryManager.shared().connectedAccessories.first {
            $0.serialNumber == id || "\($0.connectionID)" == id
        }
        guard let accessory = accessory else { done("The printer is not connected. Turn it on, or pair it in Settings → Bluetooth."); return }
        guard accessory.protocolStrings.contains(proto), let session = EASession(accessory: accessory, forProtocol: proto),
              let output = session.outputStream else {
            done("Could not open the printer.")
            return
        }
        queue.async {
            output.open()
            defer { output.close() }
            let deadline = Date().addingTimeInterval(20)
            var offset = 0
            let bytes = [UInt8](data)
            while offset < bytes.count {
                if Date() > deadline { done("The printer did not take the whole job."); return }
                if output.streamStatus == .error { done(output.streamError?.localizedDescription ?? "The printer refused the job."); return }
                if output.hasSpaceAvailable {
                    let written = bytes[offset...].withUnsafeBufferPointer { output.write($0.baseAddress!, maxLength: min(1024, $0.count)) }
                    if written < 0 { done(output.streamError?.localizedDescription ?? "The printer refused the job."); return }
                    offset += written
                } else {
                    usleep(5000)
                }
            }
            // Let the last bytes leave before the session closes.
            usleep(300_000)
            _ = session
            done(nil)
        }
    }
}
