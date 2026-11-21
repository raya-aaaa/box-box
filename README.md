# Box Box

**A daily to-do app styled like an F1 pit wall.**

Every task is a **lap**, split into 1 to 6 **sectors**, each with a time estimate.
Start the timer, hit *NEXT SECTOR* as you go, and every finished lap gets a colour, like qualifying timing:

- 🟣 **Purple**: your best lap of the day (best ratio of actual time to estimate)
- 🟢 **Green**: finished within the estimate
- 🟡 **Yellow**: finished over the estimate

🔗 **Live:** https://rayaaaa-aaaa.github.io/box-box/

## Features

- Tasks as laps with up to 6 timed sectors
- Live lap timer with a delta against your estimate, and a yellow flag when you go over
- Morning / afternoon / evening sessions (Q1, Q2, Q3)
- Team colour themes based on the 2026 grid
- "Team radio" messages when a sector reaches 80% of its estimate, when a task goes over time, and when every task of the day is done
- Keeps the screen awake while a task is running
- Everything is saved in the browser (localStorage), so a refresh keeps your tasks and even a running timer
- Optional Windows desktop shortcut (`create-shortcut.ps1`) that opens the app in its own window

## How it's built

Plain HTML, CSS and JavaScript: no framework, no build step, no backend.

| File | What it does |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Pit-wall look: timing tower, sector colours, team themes |
| `app.js` | Tasks, timers, sector colours, storage, radio cues |
| `audio-config.js` | List of team radio clips and when each one plays |

I came up with the concept and the pit-wall design, collected the visual references (team colours, timing graphics, team radio layout), defined the features and tested the app. The code was written with [Claude Code](https://claude.com/claude-code).

## Run it locally

```
python -m http.server 5517
```

Then open http://localhost:5517 in your browser.

## Team radio audio

The radio clips are **not included** in this repository because they are copyrighted broadcast audio.
To add your own, put an `.mp3` file in `audio/` and add one line to `audio-config.js`.
Without audio files the radio messages still appear on screen.

## Disclaimer

Fan project, not affiliated with Formula 1 or any F1 team. Team names and colours are used for theming only.
