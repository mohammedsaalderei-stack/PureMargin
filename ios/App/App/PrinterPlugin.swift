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
        CAPPluginMethod(name: "airPrint", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "ae.puremargin.printer")

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
