import UIKit
import Capacitor

/* The app's bridge, with its own plugins registered.

   Capacitor finds plugins that arrive as packages by itself; a plugin that
   lives in the app — the printer bridge — has to be handed over here, once
   the bridge exists. The storyboard names this class instead of Capacitor's
   own so that this runs. */
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrinterPlugin())
    }
}
