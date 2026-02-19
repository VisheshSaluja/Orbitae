# Testing Orbitae (macOS)

Since this application is currently in **Alpha Testing** and not yet signed with an Apple Developer Certificate, macOS may flag it as "damaged" or "unidentified". This is a standard security feature.

Follow these steps to run the app:

## Method 1: The "Right-Click" Trick (Easiest)
1.  Download the `.dmg` file and install the app to your `Applications` folder.
2.  **Right-click** (or Control-click) on the **Orbitae** app icon.
3.  Select **Open** from the menu.
4.  A dialog will appear asking if you're sure. Click **Open**.
    *   *Note: You only need to do this once. Afterwards, you can open it normally.*

## Method 2: If it says "App is Damaged"
If you see a message saying *"Orbitae is damaged and can't be opened"*, run this simple command in your Terminal:

1.  Open the **Terminal** app.
2.  Copy and paste the following command:
    ```bash
    xattr -cr /Applications/Orbitae.app
    ```
3.  Press **Enter**.
4.  Open the app normally.
