// Static user's guide, personalized with a few TEAM_CONFIG values (site title, GitHub repo link
// for feedback). Not data-driven like the other views — this is reference content for coaches.
function renderHelpView() {
  const el = document.getElementById('view-help');
  const { owner, repo } = TEAM_CONFIG.github;
  const issuesUrl = `https://github.com/${owner}/${repo}/issues`;

  el.innerHTML = `
    <div class="card">
      <h2>What this is</h2>
      <p>${TEAM_CONFIG.siteTitle} replaces a spreadsheet for running a middle-school golf team:
      roster, practice/tryout scores, match-day scoring, rolling averages, and trend charts. It
      runs entirely in your browser — there's no server, so your data lives on whichever device
      and browser you're using unless you export it or an admin publishes a report.</p>
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
      <p>Enter each course's 9 hole pars. A course marked <span class="badge warn">unverified</span>
      means its pars haven't been double-checked against an official source yet — treat scores
      from it with a little caution until someone confirms the card.</p>
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
      than guessing a number.</p>
    </div>

    <div class="card">
      <h2>Export / Import</h2>
      <p>"Export data" downloads everything as a JSON file — do this regularly as a backup, since
      your data lives only in this browser until it's exported or published. "Import data" replaces
      the current data with a previously exported file.</p>
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
      <p>"Publish report" pushes the current roster/rounds/matches to a shared report page anyone
      can view without logging in (linked from the reports viewer). It always reflects the latest
      publish, but the report page has a "View as of" selector that can reconstruct standings as of
      any earlier date from that same data — so you don't need to publish every single week to see
      week-by-week progress.</p>
    </div>

    <div class="card">
      <h2>Found a bug or have an idea?</h2>
      <p>Feedback and bug reports go through GitHub Issues:
      <a href="${issuesUrl}" target="_blank" rel="noopener">${issuesUrl}</a></p>
    </div>
  `;
}
