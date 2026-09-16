# Nanshan Tennis Booking Assistant

Double-click `start-app.cmd` to open the booking website.

## Quick start: using the booking website

1. **Start the app.** Install Node.js 20 or later, then double-click `start-app.cmd`. If the browser does not open automatically, visit <http://127.0.0.1:3827/> on the same computer.
2. **Connect your account.** Select your own fresh HAR file under “Login status and session maintenance” (登录状态与会话维护), then click “Import HAR for the selected identity” (导入当前身份HAR). Alternatively, use the session synchronization helper after completing its initial setup. Detailed instructions for both methods are below.
3. **Verify your login.** Click “Check login status for the selected identity” (检查当前身份登录状态) and wait for a valid result. Only public bookings (市民订场) are currently supported; student/staff bookings are unavailable.
4. **Choose your booking.** Select the venue, booking date, start time, and end time. Enable consecutive slots across different courts if you are willing to switch courts during the session. For Dashahe, enable courts 1 and 2 only if you want to include those more expensive courts.
5. **Check availability or book immediately.** “Check live availability” (检查实时空位) is read-only and does not reserve anything. “Book now” (立即订场) attempts a real booking and can create an unpaid order.
6. **Schedule a booking instead.** Set “Execution time” (执行时间) to the date and time when you want the attempt to start, then click “Schedule booking” (定时订场). This is separate from the date and time you want to play. Check the venue's official release rules. Enable the daily-repeat checkbox only if you want the app to create another task for the following day.
7. **Keep the service available.** Leave the computer awake and connected to the internet, with the local service running. Scheduled tasks open a session synchronization window 20 minutes before execution. This does not log you in automatically: if needed, complete login in the official mini program with the synchronization helper and proxy running, then confirm successful synchronization on the website.
8. **Review the result and pay.** Watch “Tasks and orders” (任务与订单) for progress. After a court is held, open the matching unpaid order in the official mini program's “My orders” (我的订单) and pay before its deadline. A successful hold or payment-parameter request does not mean a payment notification was sent to your phone.
9. **Manage your records.** Use “Cancel task” (取消任务) to stop a task that has not started. Select completed or cancelled records and click “Delete selected records” (删除选中记录) to remove them from the list. This does not cancel official orders or clear duplicate-booking protection. If an expired or cancelled order blocks a new attempt, use the old-order reconciliation button first.

A local booking tool built with AI assistance from HAR captures of real, manual booking sessions in the official WeChat mini program. This is not an official venue product or a universal booking bot: importing a HAR file does not automatically add support for a new platform.

Each user runs the app on their own Windows computer with their own verified account. The current implementation supports public bookings (市民订场) through Nanshan Culture and Sports (南山文体通), including Shenzhen University Town Sports Center and Dashahe International Tennis Exchange Center. Features include date and time selection, scheduled bookings, daily repeats, consecutive time slots across different courts, and an option to include Dashahe's more expensive courts 1 and 2, which are excluded by default.

**Student and staff bookings are not supported yet.** The available campus HAR captures contain only the login entry page, authorization redirects, and CAPTCHA requests—not a complete workflow after successful login. A student or staff member needs to capture their own successful login, availability search, court selection, order submission, and payment-page access. A developer or AI coding assistant must then adapt and test the implementation. Uploading those files to the current app will not enable campus bookings automatically, and a public account cannot substitute for a verified campus identity.

## 1. Development workflow: complete the booking manually first

To support a new platform or account type, record the actual workflow before implementing it. The login page alone is not enough to determine how booking requests work.

1. Open a traffic capture tool that can export HAR files on the computer you will use for booking. This project uses **Fiddler Everywhere**.
2. **Enable HTTPS decryption and System Proxy before using WeChat.** Otherwise, the initial login and authorization requests may be missing.
3. Open the official booking mini program in desktop WeChat. Log in normally and complete any required identity verification.
4. Open the venue and select your actual booking category (public or student/staff), sport, date, court, and time slots.
5. Select yourself and any actual participants as required by the platform. Read the rules and confirm the price.
6. Submit the booking, open its order details, and select WeChat Pay to reach the payment page. If desktop WeChat offers “Send to phone for WeChat payment,” capture that step too. **You do not need to complete payment just to test the integration.** Submission creates a real unpaid order; handle it through the official app or let it expire according to the platform's rules.
7. Stop capturing and export a HAR covering the complete workflow.
8. Keep the HAR locally and give your local AI coding tool its file path. Explain the venue, account type, steps taken, booking release time, and expected result. Have it analyze login, availability, price validation, order submission, order verification, and payment requests before implementing an adapter.
9. Test parsing and read-only queries first. Then verify real submission using one explicitly agreed booking. Check the official order page: receiving payment parameters does not prove that a payment request reached the user's phone.

A HAR records network exchanges from that session. It may not include cached resources, everything needed to decrypt encrypted payloads, or native WeChat payment calls. Additional captures, screenshots of booking rules, and testing with a real account may still be necessary.

## 2. Capture and export a HAR with Fiddler Everywhere

### Installation and initial setup

- Download the Windows version from the [Fiddler Everywhere website](https://www.telerik.com/fiddler/fiddler-everywhere). Check the official site for licensing and trial availability.
- In Settings, find the HTTPS/certificate settings. Follow the setup instructions to install and trust Fiddler's root certificate and enable HTTPS decryption. Setting names may vary between versions.
- Return to Live Traffic and enable **System Proxy**. Reopen the mini program in desktop WeChat and confirm that its HTTPS requests appear in the list.
- If you only see CONNECT entries without the actual request paths and bodies, the capture is incomplete. Check certificate trust and HTTPS decryption.
- **Do not let Fiddler and this project's synchronization helper on port 8899 compete for the system proxy setting.** Route traffic through Fiddler while capturing a HAR; switch back to the project's proxy for session synchronization. If your internet connection depends on Clash, keep the required upstream proxy connection working rather than simply shutting Clash down. Confirm connectivity before proceeding.

### Capture and export

1. Clear old entries from the Live Traffic view so you can identify the new session. Follow the manual workflow above through the payment page.
2. Filter the request list for the target mini program. Public booking requests mainly use `nswtt.rim20.com`; static configuration may come from `nswtt-static.rim20.com`. Keep relevant venue and login redirect traffic for development analysis. Do not export only images.
3. The campus login workflow also uses `yktline.utsz.edu.cn` and `yktdt.utsz.edu.cn`, so filtering only for the Nanshan domains will omit it. Exclude unrelated applications' traffic.
4. Click the central request list and select the relevant requests. To select all requests in the current list, press Ctrl+A while that list has focus.
5. **Right-click the selected requests → Export → Choose Format → HTTPArchive / HAR.**
6. Save the file as `booking.har`. For import into this app, use a regular HAR JSON file, not an encrypted archive.
7. When finished, disable Fiddler's capture/system proxy and restore your previous network settings. If you want session synchronization without HAR imports, switch to this project's proxy setup afterward.

The export steps follow the [official Fiddler export documentation](https://www.telerik.com/fiddler/fiddler-everywhere/documentation/collaboration/exporting-and-importing).

## 3. Import your login session into the app

Developing a new integration and refreshing a login session are different tasks. For the supported public booking workflow, you only need a fresh session—you do not need to rewrite the program or create another order each time.

1. Install Node.js 20 or later and extract the project.
2. Double-click `start-app.cmd` and open <http://127.0.0.1:3827/>. This address refers to your own computer; it is not a publicly accessible website.
3. Use the capture setup above, log in normally in the official mini program, and open “Me” (我的) or the booking page. Make sure the capture includes requests to the booking API with the login Cookie. **Refreshing a login session does not require submitting another booking.**
4. Export the HAR. In the app's “Login status and session maintenance” (登录状态与会话维护) section, select the file and click “Import HAR for the selected identity” (导入当前身份HAR).
5. Click “Check login status for the selected identity” (检查当前身份登录状态). Wait for the platform to confirm that the session is valid before creating a booking task.
6. A fresh installation binds to the verified account and the user's own participant entry returned by the platform. First complete identity verification and add yourself as a saved participant in the official mini program. An existing binding cannot be directly overwritten by someone else's account.
7. When the session expires, log in again through the official app and export/import a fresh capture. Keeping a Cookie locally does not make the server accept it indefinitely.

A HAR containing only avatars, images, static home-page resources, or the campus login page may not contain a usable public booking session. Capture the relevant requests instead of repeatedly importing the same unsuitable file.

## 4. Session synchronization without HAR imports

The synchronization helper captures and validates login sessions generated by the official mini program, replacing manual HAR export and import. It **cannot initiate a fresh WeChat login on its own** and is not an official WeChat authorization integration.

Initial setup requires Python, mitmproxy, a locally generated certificate, and proxy configuration. See the [first-use setup guide (Chinese)](docs/首次使用.md). Use `start-session-sync.cmd` for a direct connection. For Clash, use `start-session-sync-clash.cmd`; its default upstream port is currently 17897 and must match your setup.

1. Keep the synchronization helper running and confirm that the system proxy points to `127.0.0.1:8899`.
2. Click “Enable synchronization for 10 minutes” (开启10分钟同步) in the app.
3. Re-enter “Me” (我的) in the official Nanshan mini program in WeChat. Log in normally if prompted. Simply leaving the page open does not guarantee that a new login request will occur.
4. Wait for the app to report successful platform verification. Opening a synchronization window, listening on a proxy port, receiving a request, and successfully validating a login are different states.
5. Scheduled tasks open a synchronization window and check login status 20 minutes before execution. If no valid session arrives, you still need to complete the official login steps manually. Keep the computer awake, the local service running, and the network connected.

Synchronization currently handles only the supported Nanshan public booking session. It does not capture campus passwords or support campus login synchronization. Adding WeChat login to our own website or mini program would not automatically grant a session for another booking platform.

## 5. Tasks, records, and payment

- “Book now” (立即订场) attempts to create a real order. “Check live availability” (检查实时空位) only queries availability.
- Scheduled tasks run at the time you select. The official platform determines release rules and bookable dates.
- Under “Tasks and orders” (任务与订单), select individual records or all deletable records, then click “Delete selected records” (删除选中记录).
- Deleting hides records from the local list. It **does not cancel official orders, issue refunds, or remove duplicate-submission protection**. The underlying evidence needed to reconcile orders is retained.
- Cancel a pending task with “Cancel task” (取消任务) before deleting its record. Running tasks cannot be deleted.
- If an old order blocks another attempt, use “Check old orders for the selected date and clear retry restrictions” (核对所选日期的旧订单，解除重试限制). Restrictions are cleared only after official status checks confirm cancellation or expiry. Deleting a list entry is not a workaround.
- A court hold must be verified against official order details. The app requests payment parameters, but the native WeChat checkout is not integrated, so automatic delivery of a payment request to your phone is not guaranteed.
- Complete payment for the matching unpaid order under “My orders” (我的订单) in the official mini program. The official page determines how much payment time remains.

## 6. Sharing and development

Each person should use their own computer and account. Share the clean distribution archive, not your entire working directory. Do not upload HAR files, Cookies, personal identity information, orders, or proxy private keys to GitHub. `.local/` and `*.har` are ignored by Git, but check the release contents before publishing.

```powershell
node --test
python tools/build-distribution.py
```

The distribution is written to `dist/tennis-local.zip`. An explicit allowlist includes source code, public configuration, launch scripts, and documentation, while excluding `.local/`. Dependency installation and initial proxy setup are not yet a one-click process.

Main components:

- `app/server.mjs` and `app/public/`: local website, task scheduling, and session synchronization.
- `src/nswtt-adapter.mjs`: public booking queries, validation, submission, and payment requests.
- `src/nswtt-transport.mjs`: request protocol and session updates.
- `src/onboarding.mjs`: initial verified account binding on a new computer.
- `src/job-records.mjs`: record removal from the list while preserving duplicate-submission evidence.
- `tools/session_sync.py`: local session synchronization proxy.

This project was developed iteratively from real workflow captures with AI assistance. Platform changes, session expiry, and testing with real accounts remain practical limitations. Student/staff support requires a complete workflow captured by an authorized user, followed by implementation and verification; importing a login-page HAR alone does not establish support.
