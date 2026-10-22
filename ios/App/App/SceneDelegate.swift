import UIKit
import Capacitor

// Apps built against the iOS 27 SDK must use the scene life cycle, or iOS
// refuses to launch them ("UIScene life cycle is required for app"). The
// window and its storyboard come from UIApplicationSceneManifest in
// Info.plist; this class exists so iOS has a scene delegate to hand them to.
//
// Under scenes, iOS stops calling the AppDelegate's open-URL and
// continue-activity methods and calls these instead, so they are forwarded to
// the same proxy the AppDelegate used, which is what Capacitor's App plugin
// listens to for appUrlOpen.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // A cold launch from a link arrives here rather than in the methods below.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
