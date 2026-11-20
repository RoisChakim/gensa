# Prompt Codex — Review PRD GENSA (dari pengguna, 2026-11-20)

> Jalankan ke Codex SEGERA (limit mingguan tinggal 1d 19h, jangan sampai
> hangus). Pengguna minta Muse yang prompt langsung.
> Codex boleh bertanya dari PRD ini — itu yang diharapkan.

## Prompt (English — terjemahan Muse dari jawaban PRD pengguna)

```
Review this PRD for GENSA, a management system for "generus" (youth
members of a religious study community). Read STATE.md and the skills
in docs/skills/ (web-security, ponytail, uiux) first.

PRD — owner's answers:

ROLES & ACCESS
1. Daerah role: can do everything like Admin, BUT cannot add generus.
   Adding generus is done only by Kelompok: they submit a new generus,
   it waits for approval from the Admin Utama, then it enters the
   attendance / member list. Daerah has its own report data: recap of
   attendance percentage for all activities at Kelompok, Desa, and
   Daerah levels. If there is a Daerah-level ngaji (study) schedule,
   Daerah creates it, and there is a QR scan in the Daerah pengurus
   account for the attendance process.
2. Desa adding generus: allowed, but needs approval from Admin Utama.
3. Desa deleting generus: allowed, but needs approval from Admin Utama,
   with a reason that truly convinces Admin Utama to approve it.
4. Accounts are created by Admin. [AMBIGUOUS: owner also mentioned a
   special registration page for admins per role — clarify which one.]
   If possible use email and allow login via Google account.
5. Password reset goes to each user's email, like normal web/apps.
6. Parent data is needed — add it.
7. Parent phone number — add it.
8. Age limits / PAUD–SD classes: inside PAUD–SD there are detailed
   sub-classes — make a new special menu for PAUD–SD; there are many
   but the owner forgot them, let Admin add them.
9. Class structure: later, Admin Utama will input it.
10. Scale: 1 daerah has 3 desa; each desa has 5–6 kelompok, with
    different kelompok names per desa.

QR ATTENDANCE & SCHEDULE
11. One QR per generus, for attendance; it cannot change. If lost,
    request a reissue from the kelompok pengurus.
12. Who scans: the pengurus of the corresponding pengajian level.
13. Offline: attendance still works offline; it auto-syncs to the
    database when internet returns; make sure there are no duplicate
    submissions.
14. Schedules can be recurring or one-time, created by each level.
    Kelompok can create; Desa can create (for remaja of 1 desa);
    Daerah can create (for all generus by jenjang/class level).
    One pengajian can be caberawit-only, combined pra remaja + remaja,
    or remaja-only.
15. Izin (leave request): through a per-kelompok izin link that was
    created and shared; pick the registered name in the
    kelompok/desa/daerah, and give the reason.
16. Attendance % report: can be weekly or monthly. Format: follow your
    suggestion first, the owner will fix it later.

MATERI & ASSESSMENT
17. Assessment matrix: use this for now (Doa & Surat = Hafal/Belum,
    Makna Pegon & Praktik Solat = Bisa/Tidak); owner will inform if
    it changes.
18. Who inputs scores: the pengurus of the corresponding level.
19. % in the Hasil tab: from the hafalan (memorization) task results,
    per level.

REPORTS & TECHNICAL
20. Report format: Word only.
21. Hosting: private server; must be installable on all devices (PWA).
22. Existing data: none yet — start empty, the owner will input it.
23. MVP / priority: owner is not sure yet (undecided).
24. Target deadline: this week.

YOUR TASK:
1. Review this PRD. Identify anything unclear, contradictory, or
   missing.
2. Ask me questions (numbered list) about the gaps, so I can answer
   and you can build accurately.
3. Do NOT start building yet — review and ask questions first.
4. Save your questions to STATE.md.
```
