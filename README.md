# Sleipnir-Keepa

Sleipnir Mobile (Android) extension that shows the Keepa price history on Amazon.de product pages.

## Features

- Reads the product page's ASIN and displays the Keepa price history chart.
- Tap to switch the time range (1 M / 3 M / 1 Y / All); your choice is remembered.
- Tap the chart to open a large view you can swipe sideways.
- Adapts to screen width, rotation and variant changes (color/size).
- Written in ES5 so it runs in any WebView version; no `SLEX_` APIs required.

## Installation

1. Copy `keepa-preisverlauf.slex.js` to your Android device.
2. Install it via the extension manager in Sleipnir Mobile.
3. Open an Amazon.de product page.

## Note

`graph.keepa.com` is not an officially documented endpoint and may change at any time. Keepa receives the ASIN when the chart is loaded (same as with the official add-on).
