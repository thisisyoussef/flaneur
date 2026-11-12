# Flâneur for iOS

SwiftUI shell (intro + native location permission) around the Flâneur engine, handing turn-by-turn to Apple/Google Maps.

## Ship to TestFlight
1. Create the app in App Store Connect: bundle ID `com.youssefa.flaneur`, name "Flâneur" (or "Flâneur: Scenic Walks").
2. App Store Connect → Users and Access → Integrations → create an API key (App Manager). Note Key ID, Issuer ID, download the .p8.
3. Repo secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (file contents).
4. Move `ios/ci/ios.yml` to `.github/workflows/ios.yml` (needs a token with workflow scope, or do it in the GitHub web editor).
5. Push or run the workflow: it compiles, archives, and uploads. The build shows up in TestFlight in ~10–20 min.

Local alternative: `brew install xcodegen && cd ios && DEVELOPMENT_TEAM=XXXX xcodegen generate && open Flaneur.xcodeproj`, then Product → Archive → Distribute.
