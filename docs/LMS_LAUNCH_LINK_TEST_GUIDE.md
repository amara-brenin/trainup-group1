# LMS Launch Link — Simple Testing Guide (Non-Technical)

> **Ye feature kya karta hai (1 line):**
> TrainUp mein bani training ka ek **secure link** banata hai jo customer apne *apne* LMS
> (Moodle, Canvas, ya koi bhi portal) mein paste kar sakta hai — learner wahi se training
> khol kar complete karta hai, aur result wapas TrainUp mein record hota hai.

---

## 🧑‍💼 Sales ko ye kyun bechna hai? (Dummy example)

**Customer:** "Acme Corp" — unke paas pehle se apna learning portal (Moodle) hai.
Wo poora TrainUp adopt nahi karna chahte, bas chahte hain ki TrainUp mein bani
"Patient Safety" training unke Moodle ke andar dikhe.

**Pehle (without this feature):** "Sorry, aapko poora platform switch karna padega." ❌
**Ab (with this feature):** "Aap bas ek link copy karke apne Moodle mein paste kar do,
training wahi chal jayegi." ✅

Yahi wo "**apne LMS ke andar TrainUp ki training**" wali baat hai.

---

## ✅ Test karne ke liye aapko kya chahiye

1. TrainUp **admin login** (jis se aap trainings banate ho).
2. Ek training jo **Approved / Published** ho (draft nahi chalega).
3. Bas ek web browser. (Koi Moodle/Canvas zaroori nahi — hum link ko seedha browser mein test karenge.)

---

## 🪜 Step-by-step Test (5 minute)

### Step 1 — Training kholo
- Admin panel → **Training Workspace** → koi ek **Approved** training kholo.
- Niche scroll karke **"Public demo access"** wale section tak jao.

### Step 2 — Launch link banao
- Wahan ab ek naya box dikhega: **"LMS / Embed launch link"**.
- 2 options hain:
  - **Generic link** → dono fields (naam/email) **khaali** chhod do. Har learner se khud naam-email poochha jayega.
  - **Personal link** → kisi ek learner ka naam + email bhar do. Us learner ke liye seedha khul jayega, bina poochhe.
- **"Generate launch link"** button dabao.
- Ek lamba sa link aayega → **Copy** dabao.

  > 💡 Ye wahi link hai jo real customer apne LMS mein paste karega.

### Step 3 — Link ko test karo (LMS ki jagah browser)
- Ek **naya browser tab** kholo (ya incognito window — taaki ye lage aap ek baahar ka learner ho).
- Copy kiya hua link paste karke **Enter** dabao.
- Ab do mein se ek hoga:
  - **Generic link** tha → ek chhota form aayega → naam + email bhar ke **"Start Training"**.
  - **Personal link** tha → seedha training khul jayegi (form nahi).

### Step 4 — Training complete karo
- Training normal tarike se chalegi (slides, questions sab waise hi).
- Poori karke dekho — completion record ho jana chahiye.

### Step 5 — Result check karo (sabse important — "data wapas aaya?")
- Wapas admin panel mein jao → usi training ka **Session Report / Results**.
- Aapka abhi-abhi wala learner (jo naam/email diya tha) **completed** dikhna chahiye, score ke saath.

  > ✅ Iska matlab: link kaam kar gaya **aur** result wapas TrainUp mein aa gaya.

---

## 🔒 Security cheezein bhi test kar sakte ho (optional, par impressive lagti hai demo mein)

| Kya karo | Kya hona chahiye |
|---|---|
| Link ke beech mein 2-3 letters badal do, fir kholo | "**Launch link is invalid or has expired**" — yaani naqli link nahi chalega ✅ |
| Bahut purana link (expire ho chuka) kholo | Wahi error — chori/leak hua link kaam nahi karega ✅ |
| Ek customer ka link doosre customer ki training nahi khol sakta | Automatically block (alag-alag tenant) ✅ |

> Default validity **7 din** hai. 7 din baad link apne aap band — naya banana padega.

---

## 🎤 Demo bolne ka script (customer ke saamne)

> "Maan lijiye aapke paas apna Moodle hai. TrainUp mein hum ye training banate hain →
> ek button dabate hain → link milta hai → aap is link ko apne Moodle ke
> 'External Link' activity mein paste karte hain. Bas. Aapke employees Moodle se hi
> ye training khologe, aur jaise hi wo complete karenge, score aur completion seedha
> TrainUp mein aa jayega. Aapko apna portal chhodna nahi padta."

---

## ❓ Common doubts

- **"Login chahiye learner ko?"** — Nahi. Link hi access hai (signed/secure).
- **"Link kisi ne forward kar diya to?"** — 7 din baad expire; aur chhed-chhaad kiya link turant invalid.
- **"Kya ye sirf web link hai ya iframe bhi?"** — Dono. Link ki tarah bhi, aur LMS ke page ke andar
  embed (iframe) bhi kar sakte hain.
- **"SCORM / LTI / xAPI?"** — Wo agle phases hain. Abhi ye **Embed/Web-link + Result wapas** wala
  sabse common case cover karta hai (jo zyादातर "apna LMS" customers ko chahiye).

---

*Is guide ka technical naam: LMS Integration — Method A/E (Signed Launch URL). Reference:
`docs/LMS_INTEGRATION_RESEARCH.md`.*
