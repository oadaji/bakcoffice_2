# Connecting OnePort 365 to Microsoft 365
**For IT Administrator · OnePort 365 · May 2026**

---

## Overview

OnePort 365 needs to connect to your company's Microsoft 365 email accounts to read incoming freight RFQ emails and send follow-up replies automatically. This is done securely via Microsoft's official OAuth 2.0 login — no passwords are stored.

This document tells you exactly what to do and what information to hand back to the development team.

---

## Who Should Do This

Your **Azure / Microsoft 365 Administrator** — the person who manages your company's Office 365 subscription or Azure Active Directory. They need either the **Global Administrator** or **Application Administrator** role.

---

## What You Will Do (Summary)

1. Register OnePort 365 as an approved app in your Azure tenant
2. Grant it permission to read and send email on behalf of your users
3. Create a secure credential (client secret)
4. Hand three values back to the development team

---

## Step-by-Step Instructions

### Step 1 — Sign into Azure Portal

Go to **[portal.azure.com](https://portal.azure.com)** and sign in with your company administrator account.

---

### Step 2 — Register the App

1. In the left menu, click **Azure Active Directory**
2. Click **App registrations** in the sidebar
3. Click **+ New registration** at the top
4. Fill in the form:

| Field | Value |
|---|---|
| **Name** | OnePort 365 |
| **Supported account types** | Accounts in this organizational directory only (Single tenant) |
| **Redirect URI** | Web — *(your developer will provide this URL)* |

5. Click **Register**

---

### Step 3 — Copy the App IDs

After registering, you will land on the app's Overview page. Copy these two values:

| Value | Where to find it |
|---|---|
| **Application (client) ID** | Listed on the Overview page |
| **Directory (tenant) ID** | Listed on the Overview page |

---

### Step 4 — Create a Client Secret

1. In the left sidebar of the app, click **Certificates & secrets**
2. Click **+ New client secret**
3. Add a description (e.g. "OnePort 365 Production")
4. Set expiry to **24 months**
5. Click **Add**
6. **Immediately copy the Value** shown in the table — it will only be visible once

> **Important:** Copy the **Value** column, not the Secret ID column.

---

### Step 5 — Grant API Permissions

1. In the left sidebar, click **API permissions**
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search for and add each of these three permissions:

| Permission | Purpose |
|---|---|
| `Mail.Read` | Read emails from connected inboxes |
| `Mail.Send` | Send follow-up emails on behalf of users |
| `User.Read` | Identify the connected account |

6. After adding all three, click **Grant admin consent for [Your Company Name]**
   — this is the blue button at the top of the permissions list
7. Confirm when prompted

> **Why admin consent?** This pre-approves the connection for all users in your organisation. Without it, each user may encounter a permissions screen they cannot approve on a managed M365 tenant.

---

## What to Send Back to the Development Team

Once complete, send these three values **securely** (not by plain email — use a password manager link, WhatsApp, or enter them directly into Replit Secrets):

| Item | Your Value |
|---|---|
| **Tenant ID** | *(copy from Step 3)* |
| **Client ID** | *(copy from Step 3)* |
| **Client Secret Value** | *(copy from Step 4)* |

---

## Security Notes

- OnePort 365 only accesses mailboxes that users explicitly connect and authorise
- No email passwords are stored — only secure OAuth tokens
- The client secret should be rotated every 24 months (set a calendar reminder now)
- If the secret is ever compromised, it can be deleted and a new one created in the same app registration without losing any other configuration

---

## Need Help?

Microsoft's official quickstart guide for app registration:
[https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

For questions specific to OnePort 365, contact your development team.

---

*OnePort 365 · Internal IT Setup Guide · May 2026*
