# TidyCall Android app

This is the full Android Studio project for the mobile app. It opens your Vercel website full screen as a real app (a *Trusted Web Activity*, Google's official way to turn a website into an Android app). Push notifications from the website appear as normal TidyCall notifications.

Because the app shows the website, **every change you make to the web code reaches the app automatically** after Vercel redeploys. You only rebuild the APK to change the app name, icon or website address.

## Files

| File | Job |
|---|---|
| `app/build.gradle` | Website address (`siteHost`) and app ID (`appId`). Edit these first |
| `app/src/main/AndroidManifest.xml` | Opens the site full screen, enables notifications, splash screen |
| `app/src/main/res/values/strings.xml` | App name |
| `app/src/main/res/values/colors.xml` | Status bar and splash colours |
| `app/src/main/res/mipmap-*/ic_launcher.png` | App icon |
| `app/src/main/res/drawable-xxhdpi/ic_notification.png` | Small white icon in the status bar |

## Build the APK

1. Install **Android Studio** from <https://developer.android.com/studio>.
2. Open `app/build.gradle` and check `siteHost` is your Vercel address (e.g. `tidycall.vercel.app`, no `https://`). Change `appId` if you want your own (e.g. `com.yourresort.tidycall`).
3. Android Studio → **Open** → select this `android` folder. Wait for "Gradle sync" to finish (the first time it downloads a few hundred MB).
4. **Build → Generate Signed App Bundle / APK → APK → Next.**
5. **Create new…** keystore: pick a file location (e.g. `tidycall.jks`, **outside** the project), set passwords, fill in your name, OK. **Back up this file and the passwords.** Without them you can never update the app.
6. Choose **release** → **Create**. The APK appears in `app/release/app-release.apk`.
7. Copy the APK to each phone and open it (allow "Install unknown apps" when asked).

## Remove the browser address bar (once)

Android only shows the app full screen when your website confirms it owns the app.

1. Get the fingerprint of your keystore. In Android Studio open the **Terminal** tab and run:
   - Windows: `"C:\Program Files\Android\Android Studio\jbr\bin\keytool" -list -v -keystore C:\path\to\tidycall.jks`
   - Mac: `"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -list -v -keystore ~/path/to/tidycall.jks`
   Enter the password and copy the line after **SHA256:** (looks like `AB:12:CD:…`).
2. In Vercel → your project → **Settings → Environment Variables** add:
   - `ANDROID_PACKAGE_NAME` = your `appId` (e.g. `com.tidycall.app`)
   - `ANDROID_SHA256` = the SHA256 line
3. Redeploy, then open `https://YOUR-SITE/.well-known/assetlinks.json`: it should show your app ID and fingerprint.
4. Uninstall and reinstall the app on the phone.

If you publish on Google Play, Play re-signs the app: copy the **App signing key SHA-256** from Play Console → *App integrity* and add it to `ANDROID_SHA256` too, separated by a comma.

## Notifications

On first open, sign in and tap **Turn on** in the yellow box; Android asks to allow notifications. For reliable alerts: phone **Settings → Apps → TidyCall → Battery → Unrestricted**.

The phone needs Google Chrome installed and up to date (it is on almost every Android phone).
