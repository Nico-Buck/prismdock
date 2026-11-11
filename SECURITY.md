# Security policy

PrismDock runs with access to your desktop and stores API keys for the services you connect, so
security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub security advisories](https://github.com/Nico-Buck/prismdock/security/advisories/new) with a
description, the affected version and steps to reproduce. You will get an answer as soon as possible,
and a fix is released before details are published.

## Supported versions

Only the latest release receives security fixes.

## Scope

In scope: the Electron app, its IPC and preload API, the native helper, secret storage and the
integrations' handling of keys. Out of scope: vulnerabilities in the third-party services themselves.
