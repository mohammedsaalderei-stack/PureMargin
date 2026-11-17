import Foundation
import Capacitor
import Network
import UIKit

/* Receipt printers, cash drawers and AirPrint, for the register.

   A web page cannot open a raw socket, and every receipt printer behind a
   counter — Epson TM, Star, Bixolon, Xprinter — takes its jobs as raw bytes on
   TCP port 9100. This is the app's way through: the register builds the
   ESC/POS bytes in JavaScript (the receipt drawn as a picture, so Arabic
   prints shaped and in order) and hands them here to be written to the
   printer. Nothing about the receipt is decided in Swift.

   `discover` lists printers announcing themselves on the local network, so a
   cashier picks "TM-m30III" from a list rather than typing an IP address.
   `airPrint` sends the same picture through iOS printing, for any printer the
   phone can already see. */
@objc(PrinterPlugin)
public class PrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrinterPlugin"
    public let jsName = "Printer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "airPrint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bluetoothScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bluetoothSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickAccessory", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "ae.puremargin.printer")
    /* Made on first use, so the Bluetooth permission is asked for when
       somebody looks for a Bluetooth printer, not when the app opens. */
    private lazy var bluetooth = BluetoothPrinters()

    /* Bluetooth printers in reach: LE ones advertising nearby, and the Epson
       or Star MFi printers already paired with this device. */
    @objc func bluetoothScan(_ call: CAPPluginCall) {
        let timeout = Double(call.getInt("timeout") ?? 4000) / 1000
        let paired = bluetooth.accessories()
        bluetooth.scan(timeout: timeout) { found, error in
            if found.isEmpty && paired.isEmpty, let error = error { call.reject(error); return }
            call.resolve(["printers": paired + found])
        }
    }

    @objc func bluetoothSend(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("No data to print.")
            return
        }
        guard let id = call.getString("id"), !id.isEmpty else { call.reject("No printer chosen."); return }
        let done: (String?) -> Void = { error in
            if let error = error { call.reject(error) } else { call.resolve(["sent": data.count]) }
        }
        if call.getString("kind") == "mfi" {
            bluetooth.sendAccessory(id: id, proto: call.getString("protocol") ?? MFI_PROTOCOLS[0], data: data, done: done)
        } else {
            bluetooth.send(id: id, data: data, done: done)
        }
    }

    /* iOS's own picker for an MFi Bluetooth printer not yet paired. */
    @objc func pickAccessory(_ call: CAPPluginCall) {
        bluetooth.pickAccessory { error in
            if let error = error { call.reject(error) } else { call.resolve(["printers": self.bluetooth.accessories()]) }
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("No data to print.")
            return
        }
        let endpoint: NWEndpoint
        if let service = call.getString("service"), !service.isEmpty {
            endpoint = .service(name: service, type: "_pdl-datastream._tcp", domain: "local.", interface: nil)
        } else if let host = call.getString("host"), !host.isEmpty,
                  let port = NWEndpoint.Port(rawValue: UInt16(call.getInt("port") ?? 9100)) {
            endpoint = .hostPort(host: NWEndpoint.Host(host), port: port)
        } else {
            call.reject("No printer address.")
            return
        }

        let connection = NWConnection(to: endpoint, using: .tcp)
        var done = false
        let finish: (String?) -> Void = { error in
            if done { return }
            done = true
            connection.cancel()
            if let error = error { call.reject(error) } else { call.resolve(["sent": data.count]) }
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                connection.send(content: data, completion: .contentProcessed { error in
                    if let error = error {
                        finish(error.localizedDescription)
                    } else {
                        // A moment for the printer to take the last bytes before the socket closes.
                        self.queue.asyncAfter(deadline: .now() + 0.4) { finish(nil) }
                    }
                })
            case .failed(let error):
                finish(error.localizedDescription)
            default:
                // `.waiting` is also where the local-network permission prompt
                // leaves a connection, so it is not treated as a failure; the
                // timeout below is.
                break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { finish("The printer did not answer.") }
    }

    @objc func discover(_ call: CAPPluginCall) {
        let timeout = Double(call.getInt("timeout") ?? 3000) / 1000
        let browser = NWBrowser(for: .bonjour(type: "_pdl-datastream._tcp", domain: nil), using: .tcp)
        var found: [[String: Any]] = []
        browser.browseResultsChangedHandler = { results, _ in
            found = results.compactMap { result in
                if case let .service(name, _, _, _) = result.endpoint {
                    return ["name": name, "service": name]
                }
                return nil
            }
        }
        browser.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) {
            browser.cancel()
            call.resolve(["printers": found])
        }
    }

    /* Printers that announce nothing. Most counter printers (iCE, Xprinter,
       Rongta and their many rebadges) take jobs on port 9100 and never
       advertise it, so `discover` cannot see them. This tries the port on
       every address of the Wi-Fi the device is on and lists the addresses
       that accept a connection. `src/print/discovery.js` joins the two lists.

       It connects and hangs up; nothing is written. An office printer on the
       same network that also listens on 9100 must not print a page of noise
       because somebody looked for a receipt printer.

       A network wider than /24 is searched only in the /24 this device is in:
       65,000 addresses is minutes, not seconds. */
    @objc func scan(_ call: CAPPluginCall) {
        let ports = (call.getArray("ports", Int.self) ?? [9100])
            .filter { $0 > 0 && $0 <= 65535 }
            .compactMap { NWEndpoint.Port(rawValue: UInt16($0)) }
        let perAttempt = Double(min(max(call.getInt("timeout") ?? 1000, 200), 5000)) / 1000
        guard !ports.isEmpty, let lan = LocalNetwork.current() else {
            call.resolve(["printers": [], "searched": 0])
            return
        }
        let targets = lan.hosts().flatMap { host in ports.map { (host: host, port: $0) } }
        /* Forty-eight at a time keeps well inside the app's limit on open
           sockets; a /24 is then about six rounds of `perAttempt`. */
        let sweep = PortSweep(targets: targets, perAttempt: perAttempt, width: 48, queue: queue)
        /* Every attempt is bounded, so the sweep is too; this is the backstop
           for a network that misbehaves. */
        sweep.start(deadline: 20) { found in
            call.resolve(["printers": found, "searched": targets.count])
        }
    }

    @objc func airPrint(_ call: CAPPluginCall) {
        guard let encoded = call.getString("image"),
              let data = Data(base64Encoded: encoded),
              let image = UIImage(data: data) else {
            call.reject("No image to print.")
            return
        }
        DispatchQueue.main.async {
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .grayscale
            info.jobName = call.getString("jobName") ?? "Receipt"
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printingItem = image
            controller.present(animated: true) { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve(["printed": completed]) }
            }
        }
    }
}

/* The IPv4 network this device is on, from its own address and mask: Wi-Fi
   (en0) first, else a wired adapter on an iPad. Private ranges only — a
   sweep must never leave the shop, and a device on mobile data alone has
   no network to search. */
struct LocalNetwork {
    let address: UInt32
    let mask: UInt32

    static func current() -> LocalNetwork? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var fallback: LocalNetwork?
        for item in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let entry = item.pointee
            guard let addr = entry.ifa_addr, let netmask = entry.ifa_netmask,
                  addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(bitPattern: entry.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_RUNNING != 0, flags & IFF_LOOPBACK == 0 else { continue }
            let name = String(cString: entry.ifa_name)
            guard name.hasPrefix("en") else { continue }
            let network = LocalNetwork(address: ipv4(addr), mask: ipv4(netmask))
            guard network.isPrivate else { continue }
            if name == "en0" { return network }
            if fallback == nil { fallback = network }
        }
        return fallback
    }

    private static func ipv4(_ pointer: UnsafeMutablePointer<sockaddr>) -> UInt32 {
        pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
    }

    /* 10/8, 172.16/12, 192.168/16. */
    var isPrivate: Bool {
        (address >> 24) == 10 || (address >> 20) == 0xAC1 || (address >> 16) == 0xC0A8
    }

    /* Every address on the network except the network's own, its broadcast
       and this device's. A mask wider than /24 is narrowed to /24. */
    func hosts() -> [String] {
        let searched = max(mask, 0xFFFF_FF00)
        let network = address & searched
        let broadcast = network | ~searched
        guard broadcast > network + 1 else { return [] }
        return (network + 1 ..< broadcast).filter { $0 != address }.map(LocalNetwork.dotted)
    }

    static func dotted(_ a: UInt32) -> String {
        "\(a >> 24).\((a >> 16) & 255).\((a >> 8) & 255).\(a & 255)"
    }
}

/* One sweep. Its state lives on one serial queue — the connections report
   on it too — so nothing here needs a lock. */
final class PortSweep {
    typealias Target = (host: String, port: NWEndpoint.Port)

    private let queue: DispatchQueue
    private let perAttempt: TimeInterval
    private let width: Int
    private var targets: [Target]
    private var running = 0
    private var found: [[String: Any]] = []
    private var finished = false
    private var report: (([[String: Any]]) -> Void)?

    init(targets: [Target], perAttempt: TimeInterval, width: Int, queue: DispatchQueue) {
        self.targets = targets
        self.perAttempt = perAttempt
        self.width = max(1, width)
        self.queue = queue
    }

    func start(deadline: TimeInterval, report: @escaping ([[String: Any]]) -> Void) {
        queue.async {
            self.report = report
            self.queue.asyncAfter(deadline: .now() + deadline) { self.finish() }
            if self.targets.isEmpty { self.finish(); return }
            for _ in 0..<self.width { self.next() }
        }
    }

    private func next() {
        if finished { return }
        if targets.isEmpty {
            if running == 0 { finish() }
            return
        }
        let target = targets.removeFirst()
        running += 1
        let connection = NWConnection(host: NWEndpoint.Host(target.host), port: target.port, using: .tcp)
        var settled = false
        let settle: (Bool) -> Void = { open in
            if settled { return }
            settled = true
            connection.stateUpdateHandler = nil
            connection.cancel()
            if open { self.found.append(["host": target.host, "port": Int(target.port.rawValue)]) }
            self.running -= 1
            self.next()
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                settle(true)
            case .failed, .cancelled:
                settle(false)
            case .waiting(let error):
                /* Refused or nobody there: closed, without waiting out the
                   clock. Any other wait — the local-network prompt among
                   them — runs to the timeout below. */
                if case .posix(let code) = error,
                   [POSIXErrorCode.ECONNREFUSED, .EHOSTDOWN, .EHOSTUNREACH, .ENETUNREACH].contains(code) {
                    settle(false)
                }
            default:
                break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + perAttempt) { settle(false) }
    }

    private func finish() {
        if finished { return }
        finished = true
        targets.removeAll()
        let report = self.report
        self.report = nil
        report?(found)
    }
}
