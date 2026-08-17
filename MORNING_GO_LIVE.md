# AI Factory — Morning Go-Live Checklist

The code should already be on `main` and Cloudflare should rebuild automatically after the merge. Your job is only to verify the deployment, enable the real URL, and add the two private secrets that make the dashboard fully useful.

## 1. Confirm Cloudflare deployed `main`

1. Open Cloudflare.
2. Go to **Workers & Pages**.
3. Open **ai-factory**.
4. Open **Builds**.
5. The newest production build should use branch **main** and finish successfully.
6. If you need to verify settings: **Settings > Build > Branch control** should use `main`.
7. Deploy command should be `npx wrangler deploy`.
8. There is no required build command for this project.

## 2. Fix / verify the public workers.dev address

Do not guess the account subdomain.

1. Go back to **Workers & Pages**.
2. Find **Your subdomain** and note the exact value Cloudflare shows.
3. Open **ai-factory > Settings > Domains & Routes**.
4. Make sure the `workers.dev` route is enabled.
5. The correct address is:

   `https://ai-factory.<YOUR-EXACT-CLOUDFLARE-SUBDOMAIN>.workers.dev`

6. Open the exact URL Cloudflare displays.
7. If the old guessed URL still gives `DNS_PROBE_FINISHED_NXDOMAIN`, ignore it and use the exact subdomain shown by Cloudflare.

## 3. Add the write key (required to edit Project Brain, Decision Engine and Knowledge Mine)

1. Open **ai-factory > Settings**.
2. Under **Variables and Secrets**, tap **Add**.
3. Type: **Secret**.
4. Variable name: `AI_FACTORY_KEY`
5. Value: create a long unique random passphrase/password that only you know.
6. Save and **Deploy** the change.
7. Do not commit this value to GitHub.

The first time you save something in AI Factory, the site will ask for this key. It is kept in your browser session, not displayed in the repository.

## 4. Optional: add a GitHub read token for private repos and fuller build data

The dashboard can read public repositories without one. Add this only if you need private-repository visibility or GitHub API limits become a problem.

1. In GitHub, create a **fine-grained personal access token**.
2. Restrict it to only the repositories AI Factory needs to monitor.
3. Give it read-only repository permissions needed for repository/commit/release data and Actions workflow status. Do not grant write permissions.
4. Back in Cloudflare: **ai-factory > Settings > Variables and Secrets > Add > Secret**.
5. Name: `GITHUB_TOKEN`
6. Paste the token value.
7. Save and **Deploy**.
8. Never commit this token to GitHub.

## 5. Smoke-test the live factory

Open the AI Factory URL and check these in order:

1. **Mission Control** — project cards load.
2. **Watchtower** — incidents/attention queue loads.
3. **Release Factory** — build state loads; release/APK links appear when a repo has them.
4. **Today / Priority** — ordered daily list appears.
5. **Decision Engine** — create one small test decision case and save it.
6. **Knowledge Mine** — save one test lesson.
7. **Project Brain** — open AI Factory, change a next action, save it, refresh, and confirm it stayed saved.

## 6. Health check if the UI looks broken

Open:

`https://<YOUR-AI-FACTORY-URL>/api/health`

Expected result includes:

- `ok: true`
- `runtime: cloudflare-workers`
- `database: d1`
- systems including Mission Control, Watchtower, Release Factory, Today, Decision Engine and Knowledge Mine

If `/api/health` works but the dashboard does not, the problem is the static UI. If `/api/health` fails too, check the latest Cloudflare build/deployment logs.

## 7. What each system does

- **Mission Control** — one view of every tracked project.
- **Watchtower** — automatically flags failed builds, unavailable repos, stale work and blockers.
- **Release Factory** — shows latest workflow state, GitHub release and APK link where one exists.
- **Today / Priority** — converts incidents, blockers and next actions into the top daily action list.
- **Decision Engine** — stores problem, options, recommendation, final decision and reason.
- **Knowledge Mine** — stores what happened, lesson learned, reusable principle and content angle.
- **Project Brain** — working memory for each product: current state, next actions, blockers and permanent decisions.

## 8. What is deliberately NOT automatic yet

This MVP does not use the OpenAI API or paid background agents. It uses GitHub + Cloudflare + deterministic rules so it stays cheap/free. Future automation can be added on top once the control system is stable.
