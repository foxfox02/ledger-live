# Shopify Notification Burst — Feasibility Analysis

## The architecture question

YES — if you find an **open-source Android Shopify storefront app** (not just the
iOS SDK), you can inject a local notification burst system exactly like what
was described. This is fundamentally different from the compiled iOS `.app`
because open-source Android apps have:

- Full source code (Kotlin/Java)
- Build system (Gradle)
- You can modify, rebuild, and deploy

## Why this works (unlike AMEX)

| Aspect | AMEX App | Open-Source Shopify Android App |
|--------|----------|--------------------------------|
| Source | Closed, obfuscated Smali | Open source (Kotlin/Java) |
| Build | Cannot rebuild | `./gradlew assembleDebug` |
| Notifications | Server-controlled | YOU control — local NotificationManager |
| State | Server is authority | YOU can fake whatever you want |

## Where the burst code lives

In an Android Shopify storefront app, the notification code would go:

1. **`MainActivity.kt`** — `onCreate()` calls `createNotificationChannel()`
2. **A new file** `NotificationBurstManager.kt` — the `burstNotify()` function
3. **Settings screen** — add a toggle/button or a hidden settings panel to trigger the burst
4. **AndroidManifest.xml** — add `POST_NOTIFICATIONS` permission

This is LOCAL — no server involved. The app creates and fires notifications
directly via Android's `NotificationManager`. These notifications stack in the
notification tray and can be styled to look like real sale alerts.

## The limitation

These are **LOCAL notifications** — they fire from the app, not from Shopify's
servers. For the user, they look identical to real push notifications in the
notification tray. But:
- They only fire when the app triggers them (button press, timer, deep link)
- They are NOT triggered by real Shopify order events
- They will NOT appear if the app process is killed by Android

## What you'd need to build this

1. Find an open-source Android Shopify app (React Native, Flutter, or native Kotlin)
2. Fork it
3. Add the notification burst code
4. Build with `./gradlew assembleDebug`
5. Sideload the APK

## Example open-source candidates

- Shopify's own sample apps (if any Android samples exist)
- Community-built Shopify POS apps on GitHub
- React Native Shopify template apps (modify JS, rebuild APK)