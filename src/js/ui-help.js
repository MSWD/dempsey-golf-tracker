// Static user's guide, personalized with a few TEAM_CONFIG values (site title, GitHub repo link
// for feedback). Not data-driven like the other views — this is reference content for coaches.
function renderHelpView() {
  const el = document.getElementById('view-help');
  const { owner, repo } = TEAM_CONFIG.github;
  const issuesUrl = `https://github.com/${owner}/${repo}/issues`;

  el.innerHTML = `
    <div class="card notice">
      <h2>⚠️ Your data lives only in this browser, on this device — read this first</h2>
      <p>Everything you type into this app — roster, courses, rounds, matches — is saved
      <strong>only in the local storage of the specific browser and device you typed it
      into.</strong> Nothing is sent to a server or synced automatically, anywhere, ever.
      Concretely, that means:</p>
      <ul>
        <li><strong>A different browser on the same computer</strong> (Chrome vs. Safari, or a
        private/incognito window) has its <strong>own, separate, empty copy</strong> — it will not
        show what you entered elsewhere.</li>
        <li><strong>A different computer, tablet, or phone</strong> — same thing: its own separate,
        empty copy.</li>
        <li><strong>Clearing your browser's data, reinstalling the browser, or getting a new
        device</strong> will <strong>permanently delete</strong> everything you've entered, with no
        way to recover it.</li>
        <li>Another coach on your team logging in on <em>their</em> computer does
        <strong>not</strong> see the data you entered on yours — you're each looking at your own
        browser's local copy.</li>
      </ul>
      <p>The <strong>only</strong> ways data leaves your browser are "Export data" below (a backup
      file you save yourself), or an admin clicking <strong>"Publish report"</strong>, which pushes
      a snapshot to a shared page everyone can see. If you do neither, and something happens to
      this browser/device, that data is gone. <strong>Export a backup regularly</strong> — treat it
      like saving a document.</p>
    </div>

    <div class="card">
      <h2>What this is</h2>
      <p>${TEAM_CONFIG.siteTitle} replaces a spreadsheet for running a middle-school golf team:
      roster, practice/tryout scores, match-day scoring, rolling averages, and trend charts. It
      runs entirely in your browser — there's no server, so your data lives on whichever device
      and browser you're using unless you export it or an admin publishes a report (see the
      warning above).</p>
    </div>

    <div class="card">
      <h2>Viewer vs. admin mode</h2>
      <p>Anyone visiting this site is a <strong>viewer</strong> by default — you can look around,
      but "Add player," "Log a round," and similar forms are hidden. Clicking
      <strong>"Login with GitHub"</strong> and signing in with a GitHub account that's listed as an
      admin for this team unlocks editing and the "Publish report" button. Any GitHub account can
      attempt to log in; whether it becomes an admin depends on whether it's on this team's admin
      list, not on anything you can change yourself.</p>
      <p class="muted">If login isn't working yet, the platform operator may not have finished
      setting up GitHub/Cloudflare for this team — ask them.</p>
    </div>

    <div class="card">
      <h2>Roster</h2>
      <p>Add players with first name, last name, and grade. Use the "Active" checkbox to hide a
      player from rank/rounds without deleting their history — inactive players keep their past
      rounds but drop off the rank table and round-entry player list.</p>
    </div>

    <div class="card">
      <h2>Courses</h2>
      <p>Enter each course's hole pars as either a 9-hole card or a full 18-hole card. For an
      18-hole course, rounds and matches ask whether you're playing the front side (holes 1-9) or
      back side (holes 10-18). A course marked <span class="badge warn">unverified</span> means
      its pars haven't been double-checked against an official source yet — treat scores from it
      with a little caution until someone confirms the card.</p>
      <p>Open "Tee sets" under a course to add named tees (e.g. "Gold," "Forward") with their own
      yardages — name them whatever you like. On an 18-hole course, enter yardages for both the
      front and back sides. Par is normally the same on every tee, so you don't need to enter it
      again; only check "different par on this tee" if that specific tee actually changes par on a
      hole or two (rare). Selecting a tee set when logging a round or match shows the resulting
      par and yardage for the selected side.</p>
      <p>Mark one tee set as the <strong>default</strong> (radio button in the tee sets table) if
      your team usually plays a particular color at that course — it'll be pre-selected next time
      you log a round or match there. Different courses can have different defaults.</p>
    </div>

    <div class="card">
      <h2>Rounds</h2>
      <p>Log tryout or practice rounds hole-by-hole. A couple of rules apply automatically:</p>
      <ul>
        <li><strong>Double-par cap</strong> — a hole score can never count as more than 2x that
        hole's par (a par 4 tops out at 8, etc.), even if you enter a higher number. You'll see a
        note if a score was capped.</li>
        <li><strong>Minimum holes</strong> — a round needs enough holes actually completed to
        count toward rank or team score. Rounds with too few holes show an
        <span class="badge warn">incomplete</span> badge and are excluded from the numbers below.</li>
        <li><strong>Adjusted score</strong> — scores are normalized to a par-36 baseline so a round
        on an executive/short course compares fairly with a full 9-hole round. Rank and rolling
        average always use this adjusted number, never the raw score.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Rank</h2>
      <p>Sorted by rolling average — the best 4 of a player's last 6 valid rounds (adjusted
      scores), tryouts counting as the earliest rounds. This is a <strong>reference only</strong> —
      the coach always sets the actual lineup order by hand; nothing here gets auto-applied.</p>
      <p>This tab is where the local-vs-published distinction shows up most directly:</p>
      <ul>
        <li><strong>Admins</strong> see a <em>live</em> table computed from this browser's local
        data, plus a link to the currently published report so you can compare the two before
        publishing.</li>
        <li><strong>Viewers</strong> (anyone not logged in as an admin on this device) don't get
        the live table at all — they're shown a link straight to the published report instead.
        That's deliberate: a viewer's own browser almost never has the coach's actual data in it,
        so showing a "rank table" computed from it would just be showing empty or stale
        numbers.</li>
      </ul>
    </div>

    <div class="card">
      <h2>Charts</h2>
      <p>Per-player scoring and putts trends over time, drawn from the same rounds used for rank.</p>
    </div>

    <div class="card">
      <h2>Matches</h2>
      <p>A match card can have 2 or 3 teams. Add each team's players with their hole-by-hole
      scores; uncheck "Starter" for anyone who's just playing an extra round that day and shouldn't
      count toward the team score. Team score is the sum of the 4 lowest scores among the 6
      starters who posted a valid score — if fewer than 4 have, it shows as "incomplete" rather
      than guessing a number. The lowest-scoring team in a match is highlighted with a "Winner"
      badge once at least two teams have a complete score. The player (or players, if tied) with
      the lowest individual score across every team in the match gets a 🏆 medalist badge.</p>
      <p>The "Season record" shown at the top counts a 3-team match as two separate results — one
      against each opponent — since your team might beat one and lose to the other in the same
      match. A result only counts once both teams being compared have a complete score.</p>
      <p><strong>Unlike the Rank tab, the Matches tab always shows this browser's local data, to
      viewers and admins alike</strong> — it does not currently redirect viewers to the published
      report or link out to it. So if you're a viewer checking match results from a device that
      isn't the coach's, what you see here (likely blank, or an out-of-date local copy) is
      <strong>not</strong> the team's real results. To see the team's actual published match
      history, go to the published report directly — reached from the link on the Rank tab, or at
      <code>reports/index.html</code> — not this tab.</p>
    </div>

    <div class="card">
      <h2>Export / Import</h2>
      <p>"Export data" downloads everything as a JSON file — do this regularly as a backup, since
      your data lives only in this browser until it's exported or published. "Import data" replaces
      the current data with a previously exported file.</p>
      <p class="admin-only">If this browser's data ever becomes corrupted or unusable, use
      <strong>"Reset local data"</strong> to clear it back to a blank season. This cannot be undone
      and will <strong>not</strong> restore this team's original starter roster or courses — export
      a backup first if you want to keep anything.</p>
      <button id="btn-reset-data" class="admin-only">Reset local data</button>
    </div>

    <div class="card">
      <h2>Privacy — this data can become public</h2>
      <p>This app's code and published reports live in a public GitHub repository, so anything
      that gets <strong>published</strong> is visible to anyone on the internet, not just people you
      share a link with. Roster names are abbreviated automatically when you publish (first name +
      last initial, e.g. "Graham B" — extended a letter or two only if two players would otherwise
      look identical), so full last names never end up in a published report even though you can
      still enter full names in your own roster.</p>
      <p>The one place this doesn't happen automatically: if you type a player's name in free-text
      on a match card (for an extra player or an opposing-team player not in your roster), whatever
      you type is published as-is. Use a first-name-and-initial format there too if that player is a
      minor.</p>
    </div>

    <div class="card">
      <h2>Publishing reports (admins only)</h2>
      <p>There's one "Publish report" button (in the header, admin-only) — it is not a per-tab or
      per-feature action. Clicking it takes <strong>everything</strong> currently in this browser's
      local data — the full roster, every round, every match — and pushes it as one combined
      snapshot to a shared report page that anyone can view without logging in, no GitHub account
      needed (linked from the reports viewer, and from the Rank tab). There's no way to publish
      just the roster, or just matches, on their own.</p>
      <p>Each publish <strong>replaces</strong> the previously published snapshot — the report page
      always shows the latest one. But the report page has a "View as of" selector that can
      reconstruct standings as of any earlier date using that same published data, so you don't
      need to publish every single week to see week-by-week progress — publishing periodically
      (e.g. after each match) is enough.</p>
      <p>The published report has one stable link (<code>&lt;your-team-domain&gt;/reports/index.html</code>
      — shown after you publish, and also linked from the Rank tab) that's meant to be
      <strong>handed out</strong>: share it with players' families, the athletic office, local
      press, whoever wants to follow along. Anyone with the link can view current rankings and
      match results without logging in or needing a GitHub account of their own. You only need to
      share the link once — it's not a snapshot of today's data, it's a page that always shows
      whichever data you <em>most recently</em> published, so the same link keeps working as the
      season goes on. Just click "Publish report" again (in the header) whenever you want that
      link to reflect newer results; nothing needs to be re-shared.</p>
      <p>Because publishing reads from <em>this browser's</em> local data, publish from whichever
      device/browser actually has the up-to-date season on it (see the warning at the top of this
      page) — publishing from a different, out-of-sync browser will overwrite the shared report
      with stale or incomplete data.</p>
    </div>

    <div class="card">
      <h2>Found a bug or have an idea?</h2>
      <p>Feedback and bug reports go through GitHub Issues:
      <a href="${issuesUrl}" target="_blank" rel="noopener">${issuesUrl}</a></p>
    </div>
  `;

  el.querySelector('#btn-reset-data').addEventListener('click', () => {
    if (!AppState.isAdmin) return;
    const confirmed = confirm(
      'Reset local data clears ALL data in this browser (roster, courses, rounds, matches) back ' +
      'to a blank season — this cannot be undone and will NOT restore this team\'s original ' +
      'starter roster or courses. Export a backup first if you want to keep anything. Continue?'
    );
    if (!confirmed) return;
    DataStore.reset();
    location.reload();
  });
}
