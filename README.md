# Apps.ClamAV
This app enables forwarding uploaded files to an open source antivirus (ClamAV) application and prevents the upload from completing in Rocket.Chat if a virus is detected. It works across web browser, desktop apps and mobile apps

Use it to prevent users from spreading viruses and malware via Rocket.Chat

ClamAV is an open source (GPL) antivirus engine used in a variety of situations, including email scanning, web scanning, and end point security. It provides a number of utilities including a flexible and scalable multi-threaded daemon, a command line scanner and an advanced tool for automatic database updates.

## Installation

You can install the ClamAV Integration via our Marketplace or manually by uploading the latest release file to your Rocket.Chat server.

After installation, make sure to properly configure both "Server Host" and "Server Port" in the app's settings.

## Notes
This app will analyse all files uploaded to your Rocket.Chat server *after* its installation. It will NOT scan all files uploaded to your server prior to then.

## Troubleshooting

In case of problems, make sure to check the app's logs. If there is any problem connecting to the ClamAV server it should be reported there.
