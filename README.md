# Thirteen with the Gang

An online version of the card game Thirteen (Tien Len) with a cast of seven characters, private tables and invite keys. No accounts.

## What is here

| File | What it does |
| --- | --- |
| `server.js` | Serves the page and runs every online table. Plain Node, one dependency (`ws`). |
| `public/index.html` | The whole game screen: lobby, table, characters, scenes, animations. |
| `public/engine.js` | The rules of Thirteen. Loaded by the page and by the server, so both agree. |
| `package.json` | Start script and the single dependency. |

## Run it

```
npm install
npm start
```

The server listens on the `PORT` environment variable, or 3000 if it is not set, on host `0.0.0.0`.
Open the site, tap **Start a private table**, and send friends the 5-letter invite key.

## How online play works

- The server keeps each table in memory and is the referee: it deals, checks every move, and plays the computer characters.
- Each player is only ever sent their own cards.
- If someone drops out mid-game the computer covers their seat until they come back with the same invite key.
- Tables are removed 15 minutes after the last person leaves.

## Hosting notes

- Run **one always-on instance**. Tables live in that one process's memory, so a host that sleeps when idle, or that runs several copies, will lose or split tables.
- Restarting or redeploying the server ends any games in progress.
- The page and the WebSocket (`/ws`) are served from the same address, so no extra configuration is needed.
- `/healthz` returns `ok` for health checks.

## House rules built in

- 3 is low, 2 is high; suits rank spades, clubs, diamonds, hearts.
- A random player leads the first game; the winner leads every game after.
- Bombs: four of a kind or three pairs in a row beats a single 2; four pairs in a row beats a pair of 2s.
