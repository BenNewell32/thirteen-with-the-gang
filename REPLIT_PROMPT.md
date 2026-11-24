# Prompt to paste into Replit

I have uploaded a finished Node.js project. Please get it running and published. Do not rewrite it.

**What it is:** an online card game. `server.js` is a plain Node server (one dependency, `ws`) that serves the files in `public/` and runs the game tables over a WebSocket at `/ws`.

**Please do this:**
1. Use Node.js 20 (anything 18 or newer works).
2. Run `npm install`.
3. Set the run command to `npm start`.
4. The server listens on `process.env.PORT`, falling back to 3000, on host `0.0.0.0`. Make sure that port is the one exposed to the web (external port 80).
5. Start it and confirm the home page loads and shows a "Start a private table" button that is not greyed out.
6. Publish it as a **Reserved VM** deployment with the smallest machine size, run command `npm start`, no build command needed beyond `npm install`. It must be Reserved VM, not Autoscale and not Static: the game keeps its tables in the memory of one always-running server process, so it cannot sleep and there must be exactly one copy running.

**Please do not:**
- Convert it to another framework, add a database, add a build step, or restructure the files.
- Change `public/index.html`, `public/engine.js` or the game logic in `server.js`. The page and server share `engine.js` and must stay in sync.
- Add sign-in or accounts. Players join with an invite key only.

**How to check it works:** open the published link in two browser windows. In the first, tap "Start a private table" and pick a character. In the second, type the 5-letter invite key, tap "Join table" and pick a different character. Back in the first window, tap "Start game". Both windows should show the same game.

If anything fails to start, show me the error from the console before changing any code.
