# Campus Market: Project Proposal

Campus Market is a mobile app where students buy and sell only with verified students from their own school, plus one open market shared by verified students from every school.

**Repository:** https://github.com/SIGMobile-UIUC/Campus-market-app

## Idea

Students trade in group chats and general marketplaces where nobody is verified, so scams and no-shows go unchecked. Campus Market gives each school a private market behind its school email (for example, `@illinois.edu`), a trust rank that shows who is reliable, and points that unlock avatar and pet customization.

## Key features

- **Campus-only markets:** Sign-up uses a one-time code sent to a school email, and the email domain places the user in their campus market. Only listed school domains are accepted. Each campus has its own colors, banner, recommended meetup spots and admins.
- **Open market:** Shared by verified students from every school. Sellers choose per listing: campus only, or also the open market.
- **Trust rank:** Iron < Bronze (start) < Silver < Gold < Platinum < Diamond < Master (top 5%) < Challenger (top 1%). Completed trades, reviews and reply speed raise it; no-shows and confirmed reports lower it. Diamond and above show their top percentage. Points can never buy rank.
- **Points, avatar and pet:** Users earn points from confirmed trades, reviews and giveaways, and spend them on avatar parts and pet items. Points have no cash value. All point logic runs on the server, with daily caps against abuse.
- **Market insights:** Anonymous, campus-level trends such as popular searches, resale prices and time to sell.

Borrowed from other marketplaces: post-trade reviews, bumping and keyword alerts (Karrot), verified badges and safe meetup spots (OfferUp), favorites and offers (Mercari), quick replies (Facebook Marketplace), and pet growth and streaks (Finch, Duolingo).

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native (Expo), TypeScript |
| Backend | Supabase: Postgres, Auth, Realtime, Storage, Edge Functions |
| Access control | Postgres row-level security keeps each campus's listings private |
| Push and email | Expo Notifications, Resend |

We start on Supabase to move fast. It runs on standard Postgres, so we can move to our own server later if cost or scale requires it.

```mermaid
flowchart LR
    App["Expo app<br/>iOS and Android"] <--> SB
    subgraph SB["Supabase"]
        Auth["Auth<br/>school email codes"]
        DB["Postgres + RLS<br/>campus separation"]
        RT["Realtime<br/>chat"]
        ST["Storage<br/>photos"]
        FN["Edge Functions<br/>points, rank, push"]
    end
    Auth --> Mail["Resend<br/>sign-in emails"]
    FN --> Push["Expo Push<br/>alerts to phones"]
```

## MVP

- School email sign-in, with the campus assigned by domain (2 to 3 schools to start)
- Campus and open market feeds; listings with photos, search, filters and favorites
- Campus theme colors and meetup spots
- One-to-one chat with photos and push notifications
- Trade completion, two-way reviews and trust rank
- Points, one avatar or pet, and a small item shop
- Reports with automatic flagging, and a campus admin view
- Consent screen and event logging for an internal trends dashboard

**Done when:** a student signs up, lists an item, chats with a buyer and marks it sold, and both users see their rank and points update. A student at another school sees the listing only if it was posted to the open market.

## After the MVP

Keyword and price-drop alerts, offers, meetup scheduling in chat, bumping listings with points, seasonal events, and escrow payments for open-market trades.

## Business model and privacy

Students are early adopters who shape what the next generation buys. After the MVP we plan to earn from campus-level trend reports, sponsored deals, and surveys that reward students with points.

- We share only anonymous totals, and hide any group smaller than 20 people.
- Chat messages are never used for ads or analytics.
- Interest-based ads go only to students who opt in. We do not collect background location, contacts or biometric data.
