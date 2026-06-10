# AI Group Training Hall — Client User Guide

A simple, step-by-step guide to running an **AI-led group training session**. No
human trainer is required during the session — the AI avatar presents the
training, answers questions, takes attendance, and ends the session
automatically at the scheduled time.

This guide is for three audiences:
- **Admin / Trainer** — who creates and schedules the training.
- **Hall Operator** — who sets up the big screen in the room.
- **Trainee** — who attends from their phone.

---

## 1. What this system does (in one picture)

```
   ADMIN                         HALL SCREEN (TV/Projector)          TRAINEE (Phone)
 ─────────                       ─────────────────────────          ───────────────
 Create training
 Choose "Group"
 Set date & time   ──────────►   Shows banner + QR + countdown  ◄── Scan QR / open email
 Assign trainees                                                     Join → Waiting room
                                                                     See countdown
        ── At the scheduled time, the AI starts the session automatically ──
                                 AI avatar presents slides           Phone shows the same
                                 + speaks narration                  slide + live progress
                                 Trainee raises hand ───────────►    Tap "Raise Hand"
                                 AI calls the name, opens mic   ◄──  Speak the question
                                 AI avatar answers out loud          See the answer
        ── After the last slide / scheduled end time, the session ends automatically ──
                                 "Session ended" screen              "Thank you" screen
 View attendance &
 reports in dashboard
```

**Key idea:** The **big screen is the classroom** (AI trainer + slides + voice).
The **phone is the companion** (follow along, raise hand, ask questions).

---

## 2. Admin / Trainer Guide

### 2.1 Create a Group Training

```
Login ─► Training ─► Create Training
   │
   ├─ Enter Title
   ├─ Training Type (Product / Soft Skills / ...)
   ├─ Delivery Type ──► select "Group Training (Hall)"
   │        │
   │        └─► fill the Group Training Hall Settings:
   │              • Session Capacity        (max trainees, e.g. 50)
   │              • Min Participants         (e.g. 1)
   │              • Start Time  ★ required for auto-start
   │              • End Time    (optional — auto-filled if left blank)
   │              • Min Attendance %         (e.g. 75)
   │              • Max Speak (secs)         (e.g. 90)
   │              • Max Questions / Trainee  (e.g. 3)
   │
   ├─ Add slides / content (same as normal training)
   ├─ Pick the AI Avatar & Voice
   └─ Submit for review ─► Approve
```

> ★ **Always set a Start Time.** This is what makes the session start
> automatically. If you leave End Time blank, the system calculates it from the
> training length.

### 2.2 Assign trainees & send invites

```
Open the approved training ─► "Assign" ─► pick trainees ─► confirm
        │
        └─► The system emails each trainee a secure join link.
```

Only **assigned** trainees can join. The email link and the hall QR code lead to
the **same** session.

### 2.3 Launch the Hall (optional)

```
Approved Group training ─► "Launch Hall"
        │
        ├─ creates the live session (if not already created)
        ├─ copies the Join Code to your clipboard
        └─ opens 2 tabs:  (1) Hall Screen   (2) Live Dashboard
```

> You do **not** have to click Launch Hall for the session to start — the system
> auto-creates and auto-starts it at the scheduled time. Launch Hall is just the
> quick way to open the hall screen and the dashboard.

### 2.4 Watch it live (Dashboard)

The **Live Dashboard** shows, in real time:
- Invited / Joined / Waiting / Present / Completed counts
- The question queue and who is speaking now
- The Q&A transcript
- Buttons: **Pause · Resume · Skip Speaker · End** (only if you ever need them)

### 2.5 After the session

Attendance and results are saved automatically and appear in the trainee
reports (attendance %, time, questions asked, completion status).

---

## 3. Hall Operator Guide (the room with the big screen)

### 3.1 What you need
- **One big screen** (TV or projector) connected to a computer with **Google Chrome**.
- **Speakers** (the AI voice plays here).
- **Internet** (stable broadband; Wi-Fi for trainee phones).
- Trainees bring **their own phones**.

> There is **no shared microphone** in the room. When the AI calls on a trainee,
> that trainee speaks into **their own phone**.

### 3.2 Steps

```
1. Open the Hall Screen link on the big-screen computer (Chrome).
2. Put it in full-screen.
3. Before start time, the screen shows: banner, title, QR code, countdown.
4. At the start time it goes live automatically.
5. ► Tap "Tap to start the presentation" ONCE  (this turns on sound).
6. Done — the AI now presents and advances slides on its own.
```

> **Step 5 is the only manual action.** Web browsers block auto-sound until one
> tap. After that single tap, everything is automatic.

### 3.3 Recommended screen layout (live)

```
┌─────────────────────────────────────────────────────────┐
│ Title         Topic: …      ⏱ timer    👥 count   [LIVE]  │
├──────────────────────────────────┬──────────┬───────────┤
│                                  │          │ NOW SPEAKING│
│        SLIDE (presentation)      │  AVATAR  │  🎤 Name     │
│                                  │ (fixed)  │ ── QUEUE ── │
│                                  │          │  1. Priya   │
│                                  │          │  2. Amit    │
└──────────────────────────────────┴──────────┴───────────┘
```

---

## 4. Trainee Guide (phone)

### 4.1 How to join

```
Option A: Open the EMAIL link
Option B: Scan the QR CODE shown on the hall screen
        │
        ▼
   Log in (your trainee account)
        │
        ▼
   Waiting Room  ──►  Countdown to start time
```

### 4.2 What happens during the session

```
Session starts  ──►  🔔 your phone alerts you (sound + vibrate)
        │
        ▼
   Your phone shows the CURRENT SLIDE + topic + progress
   (Watch & listen to the hall screen for the full experience)
        │
   Want to ask something?
        │
        ▼
   Tap  ✋ Raise Hand   ──►  you see your place in the queue
        │
   AI calls your name: "How can I help you, <name>?"
        │
        ▼
   The 🎤 Mic button turns ON  ──►  tap it and speak your question
        │
        ▼
   The AI avatar answers out loud on the hall screen
        │
        ▼
   Training continues automatically
```

> The microphone stays **OFF** until the AI calls on you. You cannot turn it on
> yourself — the AI manages speaking turns so only one person talks at a time.

### 4.3 When the training ends

You see a **"Session ended — thank you for attending"** screen. Your attendance
is recorded automatically.

---

## 5. Full Session Flow (start to finish)

```
 ADMIN sets schedule
        │
        ▼
 (System auto-creates the session before start time)
        │
        ▼
 BEFORE START ─ Hall: banner + QR + countdown │ Trainees: waiting room + countdown
        │
        ▼  ⏰ exact start time (automatic)
 ATTENTION ALERT to all phones  +  Hall goes LIVE
        │
        ▼
 PRESENTING ─ AI avatar narrates slides, advances automatically
        │
        ├─►  Trainee raises hand ─► joins queue
        │
        ▼  (at a Q&A moment)
 Q&A ─ AI greets trainee by name ─► trainee speaks ─► AI answers (avatar) ─► next in queue
        │   (strictly one trainee at a time — no overlap)
        ▼
 PRESENTING resumes ─► continues to the last slide
        │
        ▼  ⏰ end time reached (automatic)  OR  admin presses End
 COMPLETED ─ attendance finalized ─► reports generated
        │
        ▼
 Hall: "Session ended"   │   Trainees: "Thank you"   │   Admin: dashboard + reports
```

---

## 6. Quick FAQ

| Question | Answer |
|---|---|
| Do we need a human trainer in the room? | No. The AI runs the whole session. |
| Does the session start on its own? | Yes — exactly at the scheduled Start Time. |
| Do we have to click anything on the hall screen? | Just **one tap** to enable sound when it goes live. |
| Can anyone join with the link? | No — only **assigned** trainees who log in. |
| Both email link and QR — same session? | Yes, they lead to the same session. |
| What if a trainee's phone disconnects? | It reconnects automatically and restores their place. |
| Can two people talk at once? | No — the AI grants the mic to one person at a time. |
| How is attendance counted? | Automatically: join time, active time, attendance %, completion. |
| What if we open the hall screen late? | No problem — it joins the live session already in progress. |

---

## 7. Do's and Don'ts

**Do**
- Always set a **Start Time** when creating a Group training.
- Open the hall screen in **Chrome**, full-screen, with speakers on.
- Tap once to **enable sound** when the session goes live.
- Use **one** hall screen per room.

**Don't**
- Don't open the hall screen on **multiple** computers in the same room (you'll hear double audio).
- Don't expect sound before the **one tap** (browsers block auto-sound).
- Don't share the join link with non-assigned people — it won't let them in.

---

*For any setup help, contact your platform administrator.*
