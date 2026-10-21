import { money } from './finance.js'

const $ = selector => document.querySelector(selector)
const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )
let homeDetailsOpen = false
let assistantLanguage = localStorage.getItem('finmate_language') === 'zh' ? 'zh' : 'en',
  referenceData = null,
  referenceError = '',
  missionData = null,
  missionPrevious = null,
  missionSequence = 0,
  missionInputState = { sourceCurrency: 'CNY', backupCurrencies: [], incomeDelay: 0 }
const bilingual = (en, zh) => (assistantLanguage === 'zh' ? zh : en)
let securityInfo = { hasPin: false, lockedUntil: null, paymentPinRequired: true },
  pinReturnDraft = null,
  pinReturnSettings = false
let guardianReviewInput = null
let familyInput = null,
  familyResult = null,
  familySequence = 0
let semesterData = null,
  setupDraft = null,
  setupStep = 1,
  studentBusy = false
let scenarioInput = { fxDrop: 0, incomeDelay: 0, rentIncrease: 0 },
  scenarioSequence = 0
let affordabilityResult = null,
  affordabilityInput = null,
  affordabilitySequence = 0
let fundingPlans = [],
  fundingRoute = null,
  fundingBackups = null,
  fundingSequence = 0,
  tuitionSequence = 0
let state,
  csrf,
  agentInfo = { mode: 'offline' },
  baseScenario = null,
  scenarioResult = null,
  tuitionRoutes = [],
  tuitionSource = 'CNY',
  tuitionRoute = null
let currentView = 'overview',
  period = 'month',
  activityTab = 'transactions',
  search = '',
  transferDraft = { amount: 5000, from: 'CNY', to: 'EUR', route: 'student' },
  pendingAction = null,
  activeApproval = null,
  toastTimer,
  quoteSequence = 0

async function api(path, input) {
  const response = await fetch('/api/' + path, {
    method: input === undefined ? 'GET' : 'POST',
    headers:
      input === undefined ? {} : { 'Content-Type': 'application/json', 'X-FinMate-CSRF': csrf },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The server could not be reached. Start npm run dev and reload.')
  }
  if (!response.ok) {
    const error = new Error(
      data.code === 'CSRF'
        ? 'Your session changed in another tab. Reload this page and try again.'
        : data.code === 'SESSION'
          ? 'Your session is unavailable. Reload to reconnect.'
          : data.error || 'Request failed.'
    )
    error.code = data.code
    throw error
  }
  return data
}

const accountSource = () =>
  state.accounts?.origin === 'entered' ? 'Your entered balances' : 'Sample balances'
const totalEUR = balances =>
  Object.entries(balances).reduce((sum, [c, n]) => sum + n * state.market.rates[c], 0)
const monthlyEssentials = () =>
  state.budget.rent + state.budget.groceries + state.budget.transport + state.budget.other
const displayDate = date =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

async function sync(next) {
  if (next) state = next
  else {
    const data = await api('state')
    state = data.state
    agentInfo = data.agent
    securityInfo = data.security
    csrf = data.csrf
  }
  const [scenarioResponse, semesterResponse] = await Promise.all([
    api('scenario', {}),
    api('semester', {}),
  ])
  baseScenario = scenarioResponse.scenario
  semesterData = semesterResponse.plan
  $('#profile-button').textContent = state.profile.name
    .split(/\s+/)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
  if (
    missionData &&
    (missionData.revision !== state.revision ||
      missionData.marketVersion !== state.market.version ||
      missionData.day !== baseScenario.points[0].date)
  ) {
    missionPrevious = missionData
    missionData = null
    missionSequence++
  }
  if (
    affordabilityResult &&
    (affordabilityResult.revision !== state.revision ||
      affordabilityResult.marketVersion !== state.market.version ||
      affordabilityResult.calculatedOn !== baseScenario.points[0].date)
  ) {
    affordabilityResult = null
    scenarioResult = null
    affordabilitySequence++
  }
}

function toast(message) {
  $('#toast').textContent = message
  $('#toast').classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3800)
}

const footer = () =>
  `${referenceStrip()}<footer class="page-footer"><span>Simulated balances & provider quotes</span><span class="footer-tagline">At home, anywhere.</span></footer>`
const welcome = () =>
  `<div class="welcome-row"><span class="greeting">${escape(state.profile.name.split(/\s+/)[0]) ? `Hey, ${escape(state.profile.name.split(/\s+/)[0])}` : 'Hello'} <span>↗</span></span><span class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</span></div>`
const tuitionAmount = () =>
  state.invoice.paid ? 0 : state.invoice.amount * state.market.rates[state.invoice.currency]
const available = () =>
  Math.max(
    0,
    totalEUR(state.balances) - tuitionAmount() - monthlyEssentials() - state.budget.buffer
  )
const sun = () =>
  `<div class="travel-art" aria-hidden="true"><svg viewBox="0 0 200 200"><circle class="sun" cx="104" cy="98" r="62"/><g class="globe"><circle cx="104" cy="98" r="44"/><ellipse cx="104" cy="98" rx="21" ry="44"/><path d="M60 98h88M67 75q37 18 74 0M67 121q37-18 74 0M104 54v88"/></g><ellipse class="orbit" cx="101" cy="100" rx="89" ry="32" transform="rotate(-34 101 100)"/><path class="plane" d="m167 42 6-20 3-1-1 19 10 6-1 3-12-3-6 6-2-1 2-8-7-7 2-2z"/></svg><span class="spark">✧</span><span class="art-label">${escape(state.profile.homeCity.toUpperCase())} → ${escape(state.profile.studyCity.toUpperCase())}</span></div>`

function transactionRows(items) {
  if (!items.length)
    return '<p class="empty-state">Nothing here yet. Try a different search or import your statement.</p>'
  return items
    .map(
      t =>
        `<div class="transaction"><span class="transaction-icon" aria-hidden="true">${t.amount > 0 ? '↙' : /rent|housing/i.test(t.category) ? '⌂' : /transport/i.test(t.category) ? '↗' : /tuition|study/i.test(t.category) ? '▤' : '↗'}</span><div><div class="transaction-name">${escape(t.description)}</div><div class="transaction-meta">${escape(t.category)} · ${escape(t.currency)}${t.imported ? ' · Imported' : t.sample ? ' · Sample' : t.simulation ? ' · Simulated' : ''}</div></div><span class="transaction-amount ${t.amount > 0 ? 'positive' : ''}">${t.amount > 0 ? '+' : '−'}${money(Math.abs(t.amount), t.currency)}</span><time class="transaction-date" datetime="${escape(t.date)}">${new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time></div>`
    )
    .join('')
}

function graphSVG(result, days = 60) {
  if (!result) return '<p class="empty-state">Calculating your cash flow…</p>'
  const values = result.points.slice(0, days + 1),
    numbers = values.map(p => p.balance),
    buffer = state.budget.buffer
  const max = Math.ceil(Math.max(...numbers, buffer) / 1000) * 1000 + 500,
    min = Math.floor(Math.min(...numbers, buffer) / 1000) * 1000 - 200
  const point = (v, i) => [
    43 + (i / (values.length - 1)) * 580,
    112 - ((v - min) / (max - min)) * 86,
  ]
  const points = values.map((p, i) => point(p.balance, i)),
    path = points.map(p => p.join(',')).join(' '),
    bufferY = point(buffer, 0)[1]
  return `<svg class="chart scenario-chart" viewBox="0 0 660 150" preserveAspectRatio="none" role="img" aria-label="Assumption-based cash flow. Lowest balance ${money(Math.min(...numbers))}. Emergency buffer ${money(buffer)}."><path class="grid" d="M43 26h580M43 69h580M43 112h580"/><path class="area" d="M${points[0].join(',')} L${points
    .slice(1)
    .map(p => p.join(','))
    .join(
      ' L'
    )} L623,120 L43,120Z"/><line x1="43" x2="623" y1="${bufferY}" y2="${bufferY}" stroke="#bc8c7c" stroke-dasharray="3 5"/><polyline class="prediction" points="${path}"/><circle cx="${points[0][0]}" cy="${points[0][1]}" r="4" fill="#492c3d"/><text x="0" y="29">€${(max / 1000).toFixed(1)}k</text><text x="0" y="72">€${((max + min) / 2000).toFixed(1)}k</text><text x="0" y="115">€${(min / 1000).toFixed(1)}k</text><text x="43" y="143">Today</text><text x="325" y="143" text-anchor="middle">${displayDate(values[Math.floor(values.length / 2)].date)}</text><text x="623" y="143" text-anchor="end">${displayDate(values.at(-1).date)}</text><text x="611" y="${bufferY - 6}" text-anchor="end">€${buffer} buffer</text></svg>`
}

function chartSVG() {
  return graphSVG(baseScenario, period === 'month' ? 30 : 60)
}

function startingSteps() {
  const invoiceChecked =
    state.invoice.verified &&
    state.guardian.canPlan &&
    (state.profile.setupComplete ||
      state.audit.some(a =>
        ['Invoice details verified', 'Invoice details rechecked'].includes(a.title)
      ))
  return [
    {
      id: 'balances',
      done: state.accounts?.origin === 'entered',
      title: 'Start with your balances',
      description:
        'Enter the amounts in your EUR, GBP and CNY accounts. No bank login or real deposit is needed.',
      action: state.accounts?.origin === 'entered' ? 'accounts' : 'starting-balances',
      label: state.accounts?.origin === 'entered' ? 'Manage balances' : 'Enter balances',
    },
    {
      id: 'profile',
      done: state.profile.setupComplete && !semesterData.expired,
      title: 'Make the plan yours',
      description: 'Add your semester dates, living costs and expected income.',
      action: 'student-setup',
      label: state.profile.setupComplete ? 'Edit my plan' : 'Set up my plan',
    },
    {
      id: 'invoice',
      done: invoiceChecked,
      title: 'Check your tuition details',
      description: state.guardian.canPlan
        ? 'Review the recipient, amount and deadline before choosing how to pay.'
        : 'There are invoice changes to check before payment planning can continue.',
      action:
        !state.invoice.verified || state.guardian.canPlan ? 'current-invoice' : 'guardian-review',
      label: state.guardian.canPlan ? 'Check invoice' : 'Review changes',
    },
    {
      id: 'pin',
      done: securityInfo.hasPin,
      title: 'Protect your approvals',
      description: 'Set a payment PIN. You’ll enter it whenever you approve an exact payment.',
      action: securityInfo.hasPin ? 'security-settings' : 'configure-pin',
      label: securityInfo.hasPin ? 'Security settings' : 'Set up a PIN',
    },
    {
      id: 'payment',
      done: state.invoice.paid,
      title: 'Choose funding and review',
      description: 'Compare fees and arrival dates. You approve before any simulated money moves.',
      view: 'tuition',
      label: state.invoice.paid ? 'View receipt' : 'Plan my tuition',
    },
  ]
}

function gettingStarted() {
  const steps = startingSteps(),
    completed = steps.filter(s => s.done).length,
    current = steps.findIndex(s => !s.done)
  return `<section class="start-guide" aria-labelledby="start-guide-title"><div class="guide-intro"><span class="eyebrow">${completed === steps.length ? 'ALL SET FOR WHAT’S NEXT' : 'A GOOD PLACE TO BEGIN'}</span><h2 id="start-guide-title">${completed === steps.length ? 'At home<br>with your money.' : 'A few steps.<br>A clearer picture.'}</h2><p>${completed === steps.length ? 'Your starting details are sorted. Keep your plan up to date as life changes.' : 'Make the plan yours, then take care of tuition. We’ll guide you through each step.'}</p><div class="guide-progress" aria-label="${completed} of ${steps.length} complete">${steps.map(step => `<span class="${step.done ? 'complete' : ''}" aria-hidden="true"></span>`).join('')}</div><span class="guide-count">${completed} of ${steps.length} complete</span></div><ol class="guide-rows">${steps.map((step, i) => `<li class="guide-row ${step.done ? 'done' : i === current ? 'current' : ''}"><span class="guide-index" aria-hidden="true">${step.done ? '✓' : String(i + 1).padStart(2, '0')}</span><div><div class="guide-heading"><h3>${step.title}</h3><span>${step.done ? 'COMPLETE' : i === current ? 'YOUR NEXT STEP' : 'NEXT'}</span></div><p>${step.description}</p></div><button class="${i === current ? 'dark-button' : 'text-button'}" ${step.view ? `data-view="${step.view}"` : `data-action="${step.action}"`}>${step.label} <span aria-hidden="true">↗</span></button></li>`).join('')}</ol></section>`
}

function tuitionBrief() {
  const invoice = state.invoice,
    status = invoice.paid
      ? 'PAID IN PRACTICE'
      : !invoice.verified
        ? 'CHECK THE DETAILS'
        : !state.guardian.canPlan
          ? 'CHANGES TO REVIEW'
          : 'READY TO REVIEW'
  return `<aside class="tuition-brief" aria-label="Your tuition at a glance"><div class="brief-head"><span class="eyebrow">THE TUITION BRIEF</span><span class="brief-seal" aria-hidden="true">✳</span></div><div class="brief-destination"><span>${escape(state.profile.studyCity)}</span><small>${escape(invoice.recipient)}</small></div><div class="brief-art" aria-hidden="true">${sun()}</div><div class="brief-amount"><span class="eyebrow">${invoice.paid ? 'PAID AMOUNT' : 'YOUR NEXT TUITION PAYMENT'}</span><strong>${money(invoice.amount, invoice.currency)}</strong></div><div class="brief-bottom"><div><span>Due date</span><strong>${displayDate(invoice.due)}</strong></div><div><span>Invoice status</span><strong>${status}</strong></div><button class="brief-link" data-view="tuition" aria-label="Open your tuition plan">↗</button></div></aside>`
}

function pageHeading(eyebrow, title, description, action = '') {
  return `<header class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1 class="view-heading">${title}</h1></div><div class="page-lead"><p class="view-description">${description}</p>${action}</div></header>`
}

function overview() {
  const p = state.profile,
    n = semesterData.next,
    first = !p.setupComplete,
    step = startingSteps().find(s => !s.done),
    total = money(totalEUR(state.balances))
  const title = first
    ? 'New country.<br><em>A clearer plan.</em>'
    : step?.id === 'pin'
      ? 'Your money.<br>Your say.'
      : escape(n.title)
  const description = first
    ? 'Tuition, living costs and money from home, all in one place. Start with a few details—we’ll help you see what to do next.'
    : step?.id === 'pin'
      ? 'Your plan is taking shape. Add a payment PIN so every approval stays in your hands.'
      : escape(n.reason)
  const primary =
    state.accounts?.origin !== 'entered'
      ? { action: 'starting-balances', label: 'Add my balances' }
      : first
        ? { action: 'student-setup', label: 'Set up my plan' }
        : step?.id === 'pin'
          ? { action: 'configure-pin', label: 'Set up a payment PIN' }
          : {
              view: n.view,
              label:
                n.view === 'setup'
                  ? 'Update my plan'
                  : n.view === 'tuition'
                    ? 'Review tuition'
                    : n.view === 'transfers'
                      ? 'Compare a conversion'
                      : n.view === 'activity'
                        ? 'Check activity'
                        : 'Open my money plan',
            }
  return `${welcome()}<div class="workflow-entry"><span>Tuition, rent and money from home. One clear plan.</span><button class="text-button" data-view="mission">Solve my tuition problem ↗</button></div><section class="home-intro"><div><span class="eyebrow">${first ? 'YOUR LIFE ABROAD, A LITTLE SIMPLER' : 'YOUR NEXT STEP'}</span><h1>${title}</h1><p>${description}</p><div class="decision-actions"><button class="dark-button" ${primary.action ? `data-action="${primary.action}"` : `data-view="${primary.view}"`}>${primary.label} ↗</button><button class="text-button" data-action="assistant">Ask FinMate for help ↗</button></div><div class="practice-note"><span class="status-dot"></span><span>${state.accounts?.origin !== 'entered' ? 'These are example balances. Add your own numbers to make the plan useful.' : 'Your balance inputs · simulated payments · no bank connection.'}</span></div></div>${tuitionBrief()}</section><section class="home-money" aria-label="Your current balances"><div class="home-total"><span class="eyebrow">${accountSource().toUpperCase()} · EUR EQUIVALENT</span><strong>${total}</strong><small>${state.accounts?.origin === 'entered' ? 'Unverified snapshot + simulated activity' : 'Example data · replace with your starting balances'}</small></div><div class="home-currencies">${Object.entries(
    state.balances
  )
    .map(
      ([c, amount]) =>
        `<div><span class="currency-icon ${c.toLowerCase()}" aria-hidden="true">${{ EUR: '€', GBP: '£', CNY: '¥' }[c]}</span><div><span>${{ EUR: 'Euros', GBP: 'British pounds', CNY: 'Chinese yuan' }[c]}</span><strong>${money(amount, c)}</strong></div></div>`
    )
    .join(
      ''
    )}</div><button class="balance-manage-link" data-action="accounts">Manage balances ↗</button></section>${gettingStarted()}<section class="home-shortcuts" aria-label="Everyday money tasks"><div><span class="eyebrow">FOR THE EVERYDAY</span><h2>Life happens.<br><em>Plan for it.</em></h2><p>Check how a purchase affects tuition, essentials and your buffer before you decide.</p></div><button class="text-button" data-action="purchase-forecast">Check a purchase ↗</button><button class="text-button" data-view="transfers">Convert currency ↗</button></section><section class="home-agenda"><div class="section-head"><div><span class="eyebrow">COMING UP</span><h2>A few dates to keep in mind.</h2></div><button class="text-button" data-view="plan">Full semester plan ↗</button></div>${actionRows(semesterData.actions.filter(a => a.id !== 'setup').slice(0, 3))}</section><details class="home-details" id="home-cash-details" ${homeDetailsOpen ? 'open' : ''}><summary>Your cash flow and recent activity <span>＋</span></summary><section class="forecast-section"><div class="section-head"><h2>A look at the next few weeks</h2><div class="chart-controls"><button class="period-button ${period === 'month' ? 'active' : ''}" data-period="month">30 days</button><button class="period-button ${period === 'semester' ? 'active' : ''}" data-period="semester">60 days</button></div></div>${chartSVG()}<p class="plan-note">${escape(baseScenario.recommendation)} Expected income has not been credited to your accounts.</p></section><section class="recent-section"><div class="section-head"><h2>Recent activity</h2><button class="text-button" data-view="activity">All activity ↗</button></div>${transactionRows(state.transactions.slice(0, 3))}</section></details>${footer()}`
}

function plan() {
  const spent = state.transactions
    .filter(t => t.amount < 0 && /grocer|food/i.test(t.category))
    .reduce((n, t) => n + Math.abs(t.amount) * state.market.rates[t.currency], 0)
  return `${welcome()}${pageHeading('YOUR SEMESTER, SORTED', 'Your semester,<br><em>with room to live.</em>', 'A plan for the big things, with room for the little things that make a new place feel like home.', '<button class="text-button" data-action="budget">Edit living budget ↗</button>')}<nav class="page-index" aria-label="Money plan sections"><button data-jump="semester-plan">Semester dates</button><button data-jump="affordability-area">Check a purchase</button><button data-jump="living-budget">Living budget</button><button data-jump="what-if">What-if scenarios</button></nav>${semesterSection()}<div class="budget-summary"><div><span class="eyebrow">EVERYDAY BUDGET</span><div class="stat-value">${money(monthlyEssentials(), 'EUR', 0)}</div><span class="stat-caption">Monthly essentials</span></div><div><span class="eyebrow">SET ASIDE</span><div class="stat-value">${money(tuitionAmount(), 'EUR', 0)}</div><span class="stat-caption">${state.invoice.verified ? 'Verified tuition' : 'Tuition awaiting verification'}</span></div><div><span class="eyebrow">ROOM TO BREATHE</span><div class="stat-value">${money(available(), 'EUR', 0)}</div><span class="stat-caption">After tuition, one month’s essentials & buffer</span></div></div>${affordabilitySection()}<div class="section-head section-divider" id="living-budget"><h2>Your everyday, broken down</h2><span class="eyebrow">MONTHLY PLAN</span></div>${[
    ['Rent & bills', state.budget.rent],
    ['Groceries', state.budget.groceries],
    ['Transport', state.budget.transport],
    ['Everything else', state.budget.other],
  ]
    .map(
      ([label, n]) =>
        `<div class="budget-row"><span>${label}</span><div class="budget-bar"><i style="width:${Math.min(100, (n / Math.max(1, state.budget.rent)) * 100)}%"></i></div><strong>${money(n, 'EUR', 0)}</strong></div>`
    )
    .join(
      ''
    )}<p class="plan-note"><b>${money(state.budget.groceries / 4.345)} a week for groceries.</b> Food spending in your loaded transactions: ${money(spent)}. Your chosen reserve of ${money(state.budget.buffer, 'EUR', 0)} is protected by the tuition planner.</p><details class="scenario-disclosure" id="what-if"><summary><span>What if something changes?</span><span>Explore scenarios ↗</span></summary><div class="section-head"><h2>Life doesn’t always go to plan.</h2><span class="eyebrow">WHAT IF?</span></div><p class="view-description">Explore delayed income, a weaker home currency, or higher rent. These are assumptions you control.</p><form id="scenario-form" class="scenario-form"><div class="field"><label for="fx-drop">CNY loses value (%)</label><input id="fx-drop" name="fxDrop" type="number" min="0" max="30" step="1" value="${scenarioInput.fxDrop}" required></div><div class="field"><label for="income-delay">Expected income late (days)</label><input id="income-delay" name="incomeDelay" type="number" min="0" max="60" step="1" value="${scenarioInput.incomeDelay}" required></div><div class="field"><label for="rent-increase">Extra monthly rent (€)</label><input id="rent-increase" name="rentIncrease" type="number" min="0" max="2000" step="1" value="${scenarioInput.rentIncrease}" required></div><button class="dark-button" type="submit">See what changes ↗</button></form><div class="scenario-presets"><button data-scenario="late">Income 14 days late</button><button data-scenario="fx">Yuan falls 5%</button><button data-scenario="combined">A tougher month</button></div><div id="scenario-output">${scenarioHTML(scenarioResult || baseScenario)}</div></details>${footer()}`
}

function scenarioHTML(result) {
  if (!result) return '<p class="empty-state">Calculating…</p>'
  return `<div class="scenario-summary"><div><span class="eyebrow">LOWEST BALANCE</span><strong>${money(result.minBalance)}</strong></div><div><span class="eyebrow">AFTER 60 DAYS</span><strong>${money(result.endBalance)}</strong></div><div><span class="eyebrow">FX IMPACT</span><strong>${money(result.fxImpact)}</strong></div></div>${graphSVG(result)}<p class="plan-note"><b>${escape(result.recommendation)}</b><br>${escape(result.liquidityNote)}</p><details class="assumptions"><summary>See the assumptions & upcoming events</summary><p>${money(result.assumptions.monthlyIncomeEUR)} in monthly income expected across ${result.assumptions.incomeSources.length} saved sources; rent is due on day ${result.assumptions.rentDay}. Essentials follow your saved budget. Income is uncertain. Fixed simulated rates. Not a prediction.</p>${result.events.map(e => `<div class="receipt-row"><span>${displayDate(e.date)} · ${escape(e.type)}${e.uncertain ? ' (expected)' : ''}</span><strong>${money(e.amount)}</strong></div>`).join('')}</details>`
}

function tuition() {
  const invoice = state.invoice
  return `${welcome()}<div class="workflow-entry"><span>Need help choosing your next step?</span><button class="text-button" data-view="mission">Solve my tuition problem ↗</button></div>${pageHeading('TUITION · FROM DETAILS TO PAYMENT', invoice.paid ? 'Tuition,<br><em>taken care of.</em>' : 'Pay tuition.<br><em>Keep life covered.</em>', 'Check the invoice, choose where the money comes from, then review the exact payment. Your living budget stays protected.', '<button class="secondary-button" data-action="invoice">Upload an invoice ↗</button>')}${tuitionSteps()}<div class="tuition-workspace"><aside class="tuition-summary" aria-label="Invoice summary"><div class="invoice-ledger"><div><span class="eyebrow">${invoice.paid ? 'PAID IN PRACTICE ACCOUNT' : !invoice.verified ? 'NEEDS VERIFICATION' : state.guardian.canPlan ? 'INVOICE DETAILS' : 'CHANGES TO REVIEW'}</span><h2>${money(invoice.amount, invoice.currency)}</h2></div><div><strong>${escape(invoice.recipient)}</strong><p>Due ${displayDate(invoice.due)} · ${escape(invoice.reference)}</p><p>${escape(invoice.account)}</p></div></div>${!invoice.paid ? '<button class="text-button invoice-check-link" data-action="current-invoice">Check or edit these details ↗</button>' : ''}${guardianSection()}</aside><section class="tuition-planner" aria-label="Tuition payment options">${invoice.paid ? '<p class="plan-note">This invoice has already been paid. Your approval and receipt are recorded in Activity.</p><button class="dark-button" data-action="audit">View audit trail ↗</button>' : !invoice.verified ? '<p class="plan-note">Check the invoice details before comparing payment options. This keeps your plan tied to the correct recipient and amount.</p><button class="dark-button" data-action="current-invoice">Check invoice details ↗</button>' : !state.guardian.canPlan ? '<p class="plan-note">Payment comparison and preparation are paused. Review the differences above before continuing.</p>' : `<div class="tuition-constraints"><div class="field"><label for="tuition-source">Pay from</label><select id="tuition-source">${currencyOptions(tuitionSource)}</select></div><p><span class="status-dot"></span>Protect ${money(monthlyEssentials() + state.budget.buffer, 'EUR', 0)} in euros for essentials and your buffer.</p></div><div class="section-head section-divider"><h2>Choose how to fund tuition.</h2><span class="eyebrow">FEES · ARRIVAL · MONEY LEFT</span></div><div id="tuition-routes"><p class="empty-state">Comparing routes…</p></div><p id="tuition-error" class="error" role="status"></p><div class="transfer-bottom"><p>Quotes are simulated and valid for two minutes. Only routes that meet your deadline and living reserve can be approved.</p><div class="tuition-review-actions"><button class="dark-button" id="prepare-tuition" data-action="prepare-tuition" disabled>Review tuition plan ↗</button><button id="see-funding" class="text-button" data-action="see-funding" hidden>See combined plan ↘</button></div></div><div class="route-explanation"><div><h3>Why this option?</h3><p id="tuition-reason">Comparing your options…</p></div></div>${fundingSection()}${familySection()}`}</section></div>${footer()}`
}

async function loadTuition() {
  const sequence = ++tuitionSequence,
    source = tuitionSource,
    revision = state.revision,
    market = state.market.version
  tuitionRoutes = []
  tuitionRoute = null
  $('#prepare-tuition').disabled = true
  $('#tuition-error').textContent = ''
  $('#tuition-routes').innerHTML = '<p class="empty-state">Comparing routes…</p>'
  $('#tuition-reason').textContent = 'Comparing your options…'
  try {
    const result = await api('tuition/compare', { sourceCurrency: source })
    if (
      sequence !== tuitionSequence ||
      currentView !== 'tuition' ||
      source !== tuitionSource ||
      revision !== state.revision ||
      market !== state.market.version
    )
      return
    tuitionRoutes = result.routes
    tuitionRoute = tuitionRoutes.find(q => q.eligible)?.route || null
    drawTuition()
    loadFunding()
  } catch (error) {
    if (
      sequence === tuitionSequence &&
      currentView === 'tuition' &&
      source === tuitionSource &&
      $('#tuition-error')
    ) {
      $('#tuition-routes').innerHTML = ''
      $('#tuition-error').textContent = error.message
    }
  }
}

function drawTuition() {
  const selected = tuitionRoutes.find(q => q.route === tuitionRoute),
    recommended = tuitionRoutes.find(q => q.eligible)
  $('#tuition-routes').innerHTML = tuitionRoutes
    .map(
      q =>
        `<label class="route tuition-route ${q.route === tuitionRoute ? 'selected' : ''} ${q.eligible ? '' : 'ineligible'}"><input type="radio" name="tuition-route" value="${q.route}" ${q.route === tuitionRoute ? 'checked' : ''} ${q.eligible ? '' : 'disabled'}><div><strong>${escape(q.provider)}${q.route === recommended?.route ? '<span class="best-label">LOWEST FEE</span>' : ''}</strong><div class="route-meta">Arrives ${displayDate(q.arrival)} · ${money(q.fee, q.from)} fee</div>${q.reasons.length ? `<p class="route-rejection">${q.reasons.map(escape).join(' · ')}</p>` : ''}</div><div class="route-amount">${money(q.sourceAmount, q.from)}<small>${q.eligible ? 'Total incl. fee' : 'Not available'}</small></div></label>`
    )
    .join('')
  $('#prepare-tuition').disabled = !selected
  $('#see-funding').hidden = !!selected
  $('#tuition-reason').textContent = selected
    ? `${selected.provider} arrives by ${displayDate(selected.arrival)} and leaves ${money(selected.remainingEUR)} in your euro account. ${selected.route === recommended?.route ? 'This is the lowest-fee eligible route.' : `${recommended.provider} has the lowest eligible fee; your selected route has a different arrival time and fee.`}`
    : 'This account cannot fund a safe route on its own. Explore the combined plan below, using only the backups you select.'
}

function transfers() {
  return `${welcome()}${pageHeading('MONEY WITHOUT THE MILES', 'Convert currency.<br><em>See what arrives.</em>', 'A clear view of what you send, what arrives, and what it costs. Compare your options before you approve.')}<form id="transfer-form"><div class="transfer-form"><div class="field"><label for="send-amount">You send</label><div class="amount-field"><input id="send-amount" type="number" min="0.01" max="1000000" step="0.01" required value="${transferDraft.amount}"><select id="from-currency" aria-label="Source currency">${currencyOptions(transferDraft.from)}</select></div></div><div class="transfer-direction" aria-hidden="true">→</div><div class="field"><label for="receive-amount">You receive</label><div class="amount-field"><input id="receive-amount" aria-label="Amount received" readonly tabindex="-1"><select id="to-currency" aria-label="Destination currency">${currencyOptions(transferDraft.to)}</select></div></div></div><p class="transfer-helper" id="transfer-helper"></p><div id="transfer-routes" class="transfer-routes"></div><p class="error" id="transfer-error" role="status"></p><div class="transfer-bottom"><p>Fixed simulated rates. Quotes expire after two minutes. Repeated execution returns the same receipt.</p><button id="review-transfer" class="dark-button" type="submit" disabled>Review transfer ↗</button></div></form>${footer()}`
}

const currencyOptions = selected =>
  ['EUR', 'GBP', 'CNY']
    .map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`)
    .join('')

async function updateQuotes() {
  const sequence = ++quoteSequence
  transferDraft.amount = Number($('#send-amount').value)
  transferDraft.from = $('#from-currency').value
  transferDraft.to = $('#to-currency').value
  $('#review-transfer').disabled = true
  $('#receive-amount').value = ''
  $('#transfer-helper').textContent = ''
  $('#transfer-error').textContent = ''
  $('#transfer-routes').innerHTML = '<p class="empty-state">Comparing routes…</p>'
  try {
    const { routes } = await api('transfers/compare', {
      amount: transferDraft.amount,
      from: transferDraft.from,
      to: transferDraft.to,
    })
    if (sequence !== quoteSequence || currentView !== 'transfers') return
    const selected = routes.find(q => q.route === transferDraft.route) || routes[0]
    transferDraft.route = selected.route
    $('#receive-amount').value = selected.received.toFixed(2)
    $('#transfer-helper').textContent =
      `Available: ${money(state.balances[selected.from], selected.from)} · 1 ${selected.from} = ${selected.rate.toFixed(4)} ${selected.to}`
    $('#transfer-routes').innerHTML =
      `<div class="section-head"><h2>Three ways to get there</h2><span class="eyebrow">SIMULATED QUOTES</span></div>` +
      routes
        .map(
          q =>
            `<label class="route ${q.route === selected.route ? 'selected' : ''}"><input type="radio" name="provider" value="${q.route}" ${q.route === selected.route ? 'checked' : ''}><div><strong>${escape(q.provider)}</strong><div class="route-meta">${money(q.fee, q.from)} fee · arrives ${displayDate(q.arrival)}</div></div><div class="route-amount">${money(q.received, q.to)}<small>You receive</small></div></label>`
        )
        .join('')
    $('#review-transfer').disabled = !selected.sufficient
    $('#transfer-error').textContent = selected.sufficient
      ? ''
      : 'Your source account cannot cover this amount.'
  } catch (error) {
    if (sequence === quoteSequence && $('#transfer-error')) {
      $('#transfer-error').textContent = error.message
      $('#transfer-routes').innerHTML = ''
      $('#receive-amount').value = ''
    }
  }
}

function activity() {
  return `${welcome()}${pageHeading('EVERY LITTLE MOVE', 'Your activity,<br><em>all accounted for.</em>', 'Your transactions, every approval, and the decisions behind each payment. A clear record, all in one place.', '<button class="secondary-button" data-action="upload">Import statement ↗</button>')}<div class="audit-tools"><a class="secondary-button" href="/api/export" download>Export execution evidence ↙</a><button class="text-button" data-view="lab">Sandbox studio ↗</button><span class="integrity-tag">${state.auditIntegrity ? '✓ Audit chain verified' : '! Audit chain mismatch'}</span></div><div class="tabs" aria-label="Activity type"><button data-tab="transactions" class="${activityTab === 'transactions' ? 'active' : ''}" aria-pressed="${activityTab === 'transactions'}">Transactions <span class="mini-label">${state.transactions.length}</span></button><button data-tab="audit" class="${activityTab === 'audit' ? 'active' : ''}" aria-pressed="${activityTab === 'audit'}">Approvals &amp; actions <span class="mini-label">${state.audit.length}</span></button></div><div class="activity-filter"><span class="eyebrow">${activityTab === 'audit' ? 'APPROVALS & ACTIONS' : 'YOUR MONEY IN MOTION'}</span><label><span class="sr-only">Search activity</span><input id="activity-search" type="search" placeholder="Search activity…" value="${escape(search)}"></label></div><div id="activity-rows">${activityRows()}</div>${footer()}`
}

function activityRows() {
  const term = search.toLowerCase()
  if (activityTab === 'transactions')
    return transactionRows(
      state.transactions.filter(t =>
        `${t.description} ${t.category} ${t.currency}`.toLowerCase().includes(term)
      )
    )
  const items = state.audit.filter(t => `${t.title} ${t.description}`.toLowerCase().includes(term))
  if (!items.length) return '<p class="empty-state">No matching actions.</p>'
  return items
    .map(
      a =>
        `<div class="audit-row ${a.title === 'Action blocked' ? 'blocked' : ''}"><span class="audit-indicator" aria-hidden="true">${a.title === 'Action blocked' ? '!' : '✓'}</span><div><h3>${escape(a.title)}</h3><p>${escape(a.description)}</p><details class="audit-detail"><summary>Inspect this record</summary><p>Reference ${escape(a.id)}<br>Hash ${escape(a.hash)}</p><pre>${escape(JSON.stringify(a.details, null, 2))}</pre></details></div><time datetime="${escape(a.timestamp)}">${new Date(a.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<br>${new Date(a.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></div>`
    )
    .join('')
}

function lab() {
  return `${welcome()}<span class="eyebrow">SANDBOX STUDIO</span><h1 class="view-heading">Trust it.<br>Then test it.</h1><p class="view-description">Demonstrate what happens when a payment gets complicated. These controls change your simulated session only.</p><div class="plan-row"><span class="plan-num">01</span><div><h3>A deadline that can’t wait</h3><p>Move tuition to tomorrow. The cheapest slow route should be rejected.</p></div><button class="secondary-button" data-action="demo-deadline">Deadline tomorrow ↗</button></div><div class="plan-row"><span class="plan-num">02</span><div><h3>The exchange rate moves</h3><p>Reduce the yuan rate by 2%. Existing quotes must be reviewed again.</p></div><button class="secondary-button" data-action="demo-rates">Change demo rate ↗</button></div><div class="plan-row"><span class="plan-num">03</span><div><h3>A quote expires</h3><p>Prepare a tuition plan, then use “Expire quote” inside its review. The server blocks approval.</p></div><button class="secondary-button" data-view="tuition">Prepare a quote ↗</button></div><div class="plan-row"><span class="plan-num">04</span><div><h3>The same payment is submitted twice</h3><p>Execution is tied to the original approval. Retries return the original receipt.</p></div><button class="secondary-button" data-action="audit">Inspect receipts ↗</button></div><div class="plan-row"><span class="plan-num">05</span><div><h3>A shortfall in one currency</h3><p>Weaken the yuan by 5%. Use a backup account to complete tuition while keeping euro living funds intact.</p></div><button class="secondary-button" data-action="demo-funding-gap">Create a funding gap ↗</button></div><div class="import-banner"><div><h3>Ready for a fresh run?</h3><p>Reset only this browser’s simulated accounts and evidence.</p></div><button class="dark-button" data-action="reset">Reset this demo ↗</button></div><p class="plan-note">${agentInfo.mode === 'live' ? `Live model configured: ${escape(agentInfo.model)}.` : 'The offline planner is active. Configure a model on the server to enable the live agent.'} Read, compare and prepare are the agent’s only permissions. Approval and execution belong to you.</p>${footer()}`
}

function render() {
  if (!state || !semesterData || !baseScenario) return
  if ($('#home-cash-details')) homeDetailsOpen = $('#home-cash-details').open
  if ($('#initial-message') && semesterData) {
    $('#initial-message p').textContent = semesterData.next.reason
    const firstAction = $('#initial-message button')
    delete firstAction.dataset.action
    firstAction.dataset.view = semesterData.next.view
    firstAction.innerHTML = `${semesterData.next.view === 'setup' ? 'Review my student plan' : semesterData.next.view === 'activity' ? 'Check recent activity' : 'See my next step'} <span>↗</span>`
  }
  $('#main').innerHTML =
    `<div class="view-enter page-${currentView}">${{ overview, plan, tuition, transfers, activity, lab, setup, mission }[currentView]()}</div>`
  document.querySelectorAll('.nav-link').forEach(button => {
    const active =
      button.dataset.view === currentView ||
      (currentView === 'mission' && button.dataset.view === 'tuition') ||
      (currentView === 'lab' && button.dataset.view === 'activity') ||
      (currentView === 'setup' && button.dataset.view === 'overview')
    button.classList.toggle('active', active)
    if (active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  $('#agent-mode').textContent = agentInfo.mode === 'live' ? 'Live model' : 'Offline planner'
  if (currentView === 'transfers') updateQuotes()
  if (
    currentView === 'tuition' &&
    !state.invoice.paid &&
    state.invoice.verified &&
    state.guardian.canPlan
  )
    loadTuition()
}

function navigate(view, { historyMode = 'push' } = {}) {
  closeAssistant()
  if ($('#modal').open) closeModal()
  if (
    !['overview', 'plan', 'tuition', 'transfers', 'activity', 'lab', 'setup', 'mission'].includes(
      view
    )
  )
    view = 'overview'
  if (view === 'setup' && !setupDraft && state && semesterData) initializeSetup()
  if (currentView !== view) {
    quoteSequence++
    tuitionSequence++
    fundingSequence++
    scenarioSequence++
  }
  currentView = view
  search = ''
  const target = '#' + view
  if (location.hash !== target)
    history[historyMode === 'replace' ? 'replaceState' : 'pushState'](null, '', target)
  render()
  window.scrollTo({ top: 0, behavior: 'instant' })
  $('#main').focus({ preventScroll: true })
}

function openModal(content) {
  closeAssistant()
  $('#modal-content').innerHTML =
    `<div class="modal-inner"><div class="modal-top"><span class="eyebrow">FINMATE · SIMULATION</span><button class="modal-close" aria-label="Close dialog" data-action="close">×</button></div>${content}</div>`
  if (!$('#modal').open) $('#modal').showModal()
  $('#modal').scrollTop = 0
}

function closeModal() {
  $('#modal').close()
  pendingAction = null
  activeApproval = null
}

async function prepareReview(input) {
  try {
    const { draft } = await api('prepare', input)
    showReview(draft)
    await sync()
  } catch (error) {
    toast(error.message)
  }
}

function showReview(draft) {
  pendingAction = draft
  activeApproval = null
  const q = draft.quote,
    invoice = draft.invoice
  openModal(
    `<h2 id="modal-title">Review your payment.</h2><p>${invoice ? `Pay ${escape(invoice.recipient)} by ${displayDate(invoice.due)}, while preserving your living reserve.` : `Move simulated funds from your ${q.from} account to your ${q.to} account.`}</p><div class="receipt">${invoice ? `<div class="receipt-row"><span>Recipient account</span><strong>${escape(invoice.account)}</strong></div><div class="receipt-row"><span>Invoice reference</span><strong>${escape(invoice.reference)}</strong></div>` : ''}${q.legs ? q.legs.map(l => `<div class="receipt-row funding-receipt"><span>From your ${l.from} account<br><small>${escape(l.provider)} · ${money(l.fee, l.from)} fee</small></span><strong>${money(l.sourceAmount, l.from)}<br><small>Contributes ${money(l.received, l.to)}</small></strong></div>`).join('') : `<div class="receipt-row"><span>From your ${q.from} account</span><strong>${money(q.sourceAmount, q.from)}</strong></div>`}<div class="receipt-row"><span>Route & arrival</span><strong>${escape(q.provider)} · ${displayDate(q.arrival)}</strong></div><div class="receipt-row"><span>Fee included</span><strong>${q.legs ? money(q.costEUR) : money(q.fee, q.from)}</strong></div>${invoice ? `<div class="receipt-row"><span>EUR remaining / protected</span><strong>${money(q.remainingEUR)} / ${money(q.protectedEUR)}</strong></div>` : ''}<div class="receipt-row total"><span>${invoice ? 'Tuition payment' : 'You receive'}</span><strong>${money(invoice ? invoice.amount : q.received, q.to)}</strong></div></div><div class="quote-validity"><span>Quote valid until ${new Date(draft.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span>Simulated provider</span></div>${paymentPinFields()}<label class="approval-check"><input type="checkbox" id="approval-checkbox"><span>I approve this exact recipient, amount, route and fee. Only simulated funds move.</span></label><p id="approval-error" class="error" role="status"></p><div class="modal-actions"><button class="secondary-button" data-action="close">Go back</button><button class="dark-button" data-action="approve" id="approve-button" disabled>${invoice ? 'Approve & pay tuition' : 'Approve & convert'} ↗</button></div><div id="refresh-controls" hidden><button class="dark-button" data-action="refresh-quote">Get a fresh quote ↗</button></div><details class="demo-details"><summary>Demonstrate quote protection</summary><button class="text-button" data-action="expire-quote">Expire this quote ↗</button><button class="text-button" data-action="change-quote">Change the demo rate ↗</button></details>`
  )
}

async function approve() {
  if (
    !pendingAction ||
    !$('#approval-checkbox')?.checked ||
    (!activeApproval && !paymentPinReady())
  )
    return
  const draft = pendingAction
  $('#approve-button').disabled = true
  $('#approve-button').textContent = 'Checking & executing…'
  try {
    if (!activeApproval)
      activeApproval = (
        await api('approve', {
          draftId: draft.id,
          digest: draft.digest,
          confirmed: true,
          pin: $('#payment-pin').value,
        })
      ).approval
    if ($('#payment-pin')) $('#payment-pin').value = ''
    const result = await api('execute', activeApproval)
    await sync(result.state)
    pendingAction = null
    activeApproval = null
    render()
    const r = result.receipt
    openModal(
      `<div class="success-icon" aria-hidden="true">✓</div><h2 id="modal-title">${r.type.startsWith('tuition') ? 'One less thing to worry about.' : 'Your money has arrived.'}</h2><p>Executed once in the sandbox. Your approval and this receipt are linked in the server audit.</p><div class="receipt"><div class="receipt-row"><span>Recipient</span><strong>${escape(r.recipient)}</strong></div><div class="receipt-row"><span>Receipt</span><strong>${escape(r.id.slice(0, 12))}</strong></div><div class="receipt-row"><span>Audit record</span><strong>${escape(r.auditId.slice(0, 12))}</strong></div></div><button class="dark-button" data-action="audit">View audit trail ↗</button>`
    )
  } catch (error) {
    if ($('#payment-pin')) $('#payment-pin').value = ''
    $('#approval-error').textContent = error.message
    $('#approve-button').textContent = activeApproval
      ? 'Retry approved execution ↗'
      : 'Approve payment ↗'
    if (
      [
        'QUOTE_EXPIRED',
        'QUOTE_CHANGED',
        'STATE_CHANGED',
        'PLAN_MISMATCH',
        'INVOICE_CHANGED',
      ].includes(error.code)
    ) {
      $('#approval-checkbox').checked = false
      $('#approval-checkbox').disabled = true
      $('#refresh-controls').hidden = false
      activeApproval = null
    } else $('#approve-button').disabled = !activeApproval
    await sync()
  }
}

async function refreshQuote() {
  const old = pendingAction
  if (!old) return
  await sync()
  await prepareReview(
    old.type === 'tuition-funding'
      ? {
          type: 'tuition-funding',
          sourceCurrency: old.quote.sourceCurrency,
          backupCurrencies: old.quote.backupCurrencies,
        }
      : old.type === 'tuition'
        ? { type: 'tuition', sourceCurrency: old.quote.from }
        : {
            type: 'transfer',
            amount: old.quote.sourceAmount,
            from: old.quote.from,
            to: old.quote.to,
            route: old.quote.route,
          }
  )
}

function accounts() {
  const a = state.accounts || { origin: 'sample', canEditStartingBalances: true }
  openModal(
    `<h2 id="modal-title">Your money.<br>Your starting point.</h2><p>FinMate helps you plan using balances you enter. It is not a bank, and it cannot receive or verify real deposits.</p><div class="account-source-note"><span class="eyebrow">${accountSource().toUpperCase()}</span><p>${a.origin === 'entered' ? 'These are your entered starting balances plus any simulated account activity. They are not bank-verified.' : 'You’re viewing example balances. Replace them with the amounts shown in your own accounts.'}</p></div><div class="receipt">${Object.entries(
      state.balances
    )
      .map(
        ([c, n]) =>
          `<div class="receipt-row"><span>${c} · planning account</span><strong>${money(n, c)}</strong></div>`
      )
      .join(
        ''
      )}</div><div class="account-actions"><button class="dark-button" data-action="starting-balances" ${a.canEditStartingBalances ? '' : 'disabled'}>${a.origin === 'entered' ? 'Edit starting balances' : 'Enter my starting balances'} ↗</button><button class="secondary-button" data-action="deposit" ${a.origin === 'entered' ? '' : 'disabled'}>Record a simulated deposit ↗</button></div>${!a.canEditStartingBalances ? '<p class="plan-note">Starting balances are locked after simulated deposits or payments so your history stays consistent. Use a fresh sandbox account to start again.</p>' : ''}<p class="account-disclosure">Importing a statement adds transaction history; it never credits these balances. Payment planning uses illustrative exchange rates.</p>`
  )
}

function startingBalances() {
  if (!state.accounts?.canEditStartingBalances) {
    toast('Starting balances are locked after account activity.')
    return
  }
  const entered = state.accounts.origin === 'entered'
  openModal(
    `<h2 id="modal-title">Start with your numbers.</h2><p>Enter the current balance shown in each account. Use zero for currencies you don’t hold. These are planning inputs, not deposits or a bank connection.</p><form id="starting-balances-form" data-revision="${state.revision}"><div class="starting-balance-fields">${['EUR', 'GBP', 'CNY'].map(c => `<div class="field"><label for="opening-${c}">${c} balance</label><input id="opening-${c}" name="${c}" type="number" min="0" max="1000000" step="0.01" value="${entered ? state.balances[c] : ''}" placeholder="0.00" required></div>`).join('')}</div><label class="approval-check"><input type="checkbox" id="clear-sample-history" checked><span>Remove example transactions and the sample scholarship forecast. Keep any statement transactions I imported.</span></label><label class="approval-check"><input type="checkbox" id="balance-confirm" required><span>I reviewed these balances. They are self-reported planning inputs; no real money moves.</span></label><p class="error" id="balance-error" role="status"></p><button type="submit" class="dark-button" id="balance-save">Save starting balances ↗</button></form><p class="account-disclosure">After a simulated deposit or payment, opening balances are locked. Fresh payment review is required when balances change.</p>`
  )
}

async function saveStartingBalances() {
  const form = $('#starting-balances-form'),
    button = $('#balance-save')
  if (button.disabled) return
  const input = {
    balances: Object.fromEntries(
      ['EUR', 'GBP', 'CNY'].map(c => [c, Number($('#opening-' + c).value)])
    ),
    baseRevision: Number(form.dataset.revision),
    clearSampleHistory: $('#clear-sample-history').checked,
    confirmed: $('#balance-confirm').checked,
  }
  button.disabled = true
  try {
    const result = await api('accounts/starting-balances', input)
    await sync(result.state)
    setupDraft = null
    affordabilityResult = null
    scenarioResult = null
    agentDrafts.clear()
    agentFamilyPreviews.clear()
    closeModal()
    navigate('overview')
    toast('Your starting balances are saved. Plans now use your numbers.')
  } catch (error) {
    if ($('#balance-error')) $('#balance-error').textContent = error.message
  } finally {
    if ($('#balance-save')) $('#balance-save').disabled = false
  }
}

function deposit() {
  if (state.accounts?.origin !== 'entered') {
    startingBalances()
    return
  }
  openModal(
    `<h2 id="modal-title">Extra funds.<br>Recorded in practice.</h2><p>Add a simulated credit to one planning account. This does not transfer, receive, or verify real money.</p><form id="deposit-form" data-request="${crypto.randomUUID()}" data-revision="${state.revision}"><div class="deposit-fields"><div class="field"><label for="deposit-amount">Amount to record</label><input id="deposit-amount" type="number" min="0.01" max="1000000" step="0.01" placeholder="0.00" required></div><div class="field"><label for="deposit-currency">Credit account</label><select id="deposit-currency">${currencyOptions(state.profile.homeCurrency)}</select></div></div><div class="field"><label for="deposit-label">What is it for?</label><input id="deposit-label" maxlength="80" placeholder="Family support, scholarship, wages…" required></div><label class="approval-check"><input type="checkbox" id="deposit-confirm" required><span>I confirm this simulated deposit. No real funds are received and FinMate has not verified a bank payment.</span></label><p class="error" id="deposit-error" role="status"></p><button type="submit" class="dark-button" id="deposit-save">Record simulated deposit ↗</button></form><p class="account-disclosure">Recorded once, with a transaction and audit receipt. Expected-income forecasts stay separate; update your income plan if needed.</p>`
  )
}

async function saveDeposit() {
  const form = $('#deposit-form'),
    button = $('#deposit-save')
  if (button.disabled) return
  const input = {
    amount: Number($('#deposit-amount').value),
    currency: $('#deposit-currency').value,
    label: $('#deposit-label').value,
    requestId: form.dataset.request,
    baseRevision: Number(form.dataset.revision),
    confirmed: $('#deposit-confirm').checked,
  }
  button.disabled = true
  try {
    const result = await api('accounts/deposit', input)
    await sync(result.state)
    setupDraft = null
    agentDrafts.clear()
    agentFamilyPreviews.clear()
    closeModal()
    render()
    openModal(
      `<div class="success-icon" aria-hidden="true">✓</div><h2 id="modal-title">Deposit recorded.<br>In your sandbox.</h2><p>${money(result.receipt.amount, result.receipt.currency)} was added once to your planning account. No real bank transfer occurred.</p><div class="receipt"><div class="receipt-row"><span>Balance after this deposit</span><strong>${money(result.receipt.afterBalance, result.receipt.currency)}</strong></div><div class="receipt-row"><span>Receipt</span><strong>${escape(result.receipt.id.slice(0, 12))}</strong></div></div><button class="dark-button" data-action="audit">View audit trail ↗</button><button class="secondary-button" data-action="close">Done</button>`
    )
  } catch (error) {
    if ($('#deposit-error')) $('#deposit-error').textContent = error.message
  } finally {
    if ($('#deposit-save')) $('#deposit-save').disabled = false
  }
}

function upload() {
  openModal(
    `<h2 id="modal-title">Start with your statement.</h2><p>CSV columns: <b>date, description, amount, currency</b>. Use YYYY-MM-DD dates, negative spending amounts, and EUR, GBP or CNY.</p><form id="upload-form"><div class="upload-area"><span>CSV file · maximum 1 MB</span><label class="sr-only" for="csv-file">CSV statement</label><input id="csv-file" type="file" accept=".csv,text/csv" required></div><a class="sample-link" href="/sample-statement.csv" download>Download a sample statement ↙</a><p class="error" id="upload-error" role="status"></p><p class="transfer-helper">Saved in your session. Adds transactions; balances stay as shown. Descriptions cannot authorize actions.</p><button class="dark-button" type="submit">Import transactions ↗</button></form>`
  )
}

async function importFile() {
  const file = $('#csv-file').files[0]
  if (!file) return
  try {
    if (file.size > 1048576) throw new Error('Use a file smaller than 1 MB.')
    const result = await api('import', { text: await file.text() })
    await sync(result.state)
    closeModal()
    activityTab = 'transactions'
    navigate('activity')
    toast(`${result.count} transactions added.`)
  } catch (error) {
    $('#upload-error').textContent = error.message
  }
}

let extractedInvoice = null

function invoiceUpload() {
  openModal(
    `<h2 id="modal-title">From invoice<br>to a clear plan.</h2><p>Read a text-based PDF or TXT invoice, or paste its contents. You’ll verify the details before any payment can be prepared.</p><form id="invoice-extract-form"><div class="upload-area"><label for="invoice-file">Invoice file · maximum 1 MB</label><input id="invoice-file" type="file" accept=".pdf,.txt,application/pdf,text/plain"></div><label class="eyebrow" for="invoice-text">OR PASTE INVOICE TEXT</label><textarea id="invoice-text" rows="7" maxlength="50000" placeholder="Recipient: University of Amsterdam&#10;Amount due: EUR 2300.00&#10;Due date: 2026-11-01"></textarea><div class="invoice-samples"><button class="text-button" type="button" data-action="sample-invoice">Use sample invoice ↗</button><a class="sample-link" href="/samples/tuition-invoice.pdf" download>Sample PDF ↙</a></div><p class="error" id="invoice-error" role="status"></p><button class="dark-button" type="submit">Read invoice ↗</button></form><p class="transfer-helper">Extraction runs on the server, outside the AI model. Scanned images require text transcription. Document instructions never authorize payments.</p>`
  )
}

async function extractFile(useSample = false) {
  try {
    let input
    if (useSample) input = { text: await (await fetch('/samples/tuition-invoice.txt')).text() }
    else {
      const file = $('#invoice-file').files[0]
      if (file) {
        if (file.size > 1048576) throw new Error('Use a file smaller than 1 MB.')
        if (/\.pdf$/i.test(file.name)) {
          const pdf = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.onerror = () => reject(new Error('Unable to read file.'))
            reader.readAsDataURL(file)
          })
          input = { pdf }
        } else input = { text: await file.text() }
      } else input = { text: $('#invoice-text').value }
    }
    extractedInvoice = (await api('invoice/extract', input)).extracted
    invoiceVerify()
  } catch (error) {
    $('#invoice-error').textContent = error.message
  }
}

function invoiceVerify() {
  const data = extractedInvoice,
    fields = data.fields
  openModal(
    `<h2 id="modal-title">Check every detail.</h2><p>${data.source === 'saved' ? 'These are your saved tuition details. Compare them with your university invoice and correct anything that needs changing.' : 'These fields came from your document. Edit anything that needs correcting.'} Checking these details does not approve a payment.</p>${data.guardian?.flags.length ? `<div class="invoice-comparison-note"><span class="eyebrow">TUITION GUARDIAN · DOCUMENT COMPARISON</span><p>${data.guardian.flags.map(f => escape(f.label)).join(' · ')}</p><p>We compare again after you correct and verify the fields. Changes may need a separate review.</p></div>` : ''}${data.warnings.map(w => `<p class="extraction-warning">${escape(w)}</p>`).join('')}<form id="invoice-verify-form" class="invoice-fields">${[
      ['recipient', 'Recipient', 'text'],
      ['account', 'Recipient account', 'text'],
      ['reference', 'Invoice reference', 'text'],
      ['amount', 'Amount due', 'number'],
      ['due', 'Due date', 'date'],
    ]
      .map(
        ([key, label, type]) =>
          `<div class="field"><label for="invoice-${key}">${label}</label><input id="invoice-${key}" name="${key}" type="${type}" ${type === 'number' ? 'min="0.01" max="1000000" step="0.01"' : ''} maxlength="160" value="${escape(fields[key] ?? '')}" required>${data.evidence[key] ? `<small class="field-evidence">Source: ${escape(data.evidence[key])}</small>` : data.source === 'saved' ? '<small class="field-evidence">Saved detail — check against your university invoice.</small>' : '<small class="field-evidence">Not found — enter this from your invoice.</small>'}</div>`
      )
      .join(
        ''
      )}<div class="field"><label for="invoice-currency">Invoice currency</label><select id="invoice-currency" name="currency" required><option value="">Choose currency</option>${currencyOptions(fields.currency)}</select></div><label class="approval-check"><input id="verify-invoice-check" type="checkbox" required><span>I checked the recipient, account, amount, currency, reference and deadline against the invoice.</span></label><p class="error" id="invoice-error" role="status"></p><button class="dark-button" type="submit">Verify & compare routes ↗</button></form>`
  )
}

async function verifyFields() {
  const form = $('#invoice-verify-form'),
    input = Object.fromEntries(new FormData(form))
  input.amount = Number(input.amount)
  input.confirmed = $('#verify-invoice-check').checked
  try {
    const result = await api('invoice/verify', input)
    await sync(result.state)
    closeModal()
    navigate('tuition')
    toast(
      state.guardian.canPlan
        ? 'Invoice verified. Payment still needs your approval.'
        : 'Invoice saved. Tuition Guardian needs a separate change review.'
    )
  } catch (error) {
    $('#invoice-error').textContent = error.message
  }
}

function editBudget() {
  openModal(
    `<h2 id="modal-title">Room for real life.</h2><p>Choose your monthly essentials and emergency reserve. The tuition planner protects this amount in your euro account.</p><form id="budget-form" class="invoice-fields">${[
      ['rent', 'Rent & bills'],
      ['groceries', 'Groceries'],
      ['transport', 'Transport'],
      ['other', 'Everything else'],
      ['buffer', 'Emergency buffer'],
    ]
      .map(
        ([key, label]) =>
          `<div class="field"><label for="budget-${key}">${label} (€)</label><input id="budget-${key}" name="${key}" type="number" min="0" max="100000" step="0.01" value="${state.budget[key]}" required></div>`
      )
      .join(
        ''
      )}<p class="error" id="budget-error" role="status"></p><button class="dark-button" type="submit">Save my living budget ↗</button></form>`
  )
}

async function saveBudget() {
  const input = Object.fromEntries(new FormData($('#budget-form')))
  for (const key of Object.keys(input)) input[key] = Number(input[key])
  input.confirmed = true
  try {
    const result = await api('budget', input)
    await sync(result.state)
    scenarioResult = null
    closeModal()
    navigate('plan')
    toast('Living budget updated. Older quotes need a fresh review.')
  } catch (error) {
    $('#budget-error').textContent = error.message
  }
}

async function calculateScenario(preset) {
  if (preset) {
    $('#fx-drop').value = preset === 'fx' || preset === 'combined' ? 5 : 0
    $('#income-delay').value = preset === 'late' || preset === 'combined' ? 14 : 0
    $('#rent-increase').value = preset === 'combined' ? 100 : 0
  }
  const input = Object.fromEntries(new FormData($('#scenario-form')))
  for (const key of Object.keys(input)) input[key] = Number(input[key])
  scenarioInput = { ...input }
  const sequence = ++scenarioSequence,
    revision = state.revision,
    market = state.market.version
  if ($('#use-purchase-scenario')?.checked) {
    affordabilityResult = null
    affordabilitySequence++
    $('#check-purchase').disabled = false
    $('#affordability-output').innerHTML =
      '<p class="plan-note">Stress assumptions changed. Check your purchase again.</p>'
  }
  $('#scenario-output').innerHTML = '<p class="plan-note">Calculating your scenario…</p>'
  try {
    const result = (await api('scenario', input)).scenario
    if (
      sequence !== scenarioSequence ||
      revision !== state.revision ||
      market !== state.market.version
    )
      return
    scenarioResult = result
    if (currentView === 'plan' && $('#scenario-output'))
      $('#scenario-output').innerHTML = scenarioHTML(result)
  } catch (error) {
    if (sequence === scenarioSequence && currentView === 'plan' && $('#scenario-output'))
      $('#scenario-output').innerHTML = `<p class="error">${escape(error.message)}</p>`
  }
}

async function sendMessage(text) {
  if (!text.trim()) return
  if (!state || !semesterData) {
    toast('Your account is still loading. Try again in a moment.')
    return
  }
  openAssistant()
  const button = $('#chat-form button')
  if (button.disabled) return
  text = text.trim()
  $('#conversation').insertAdjacentHTML(
    'beforeend',
    `<div class="user-message"><span class="message-label">YOU</span><p>${escape(text)}</p></div><div class="agent-message" id="agent-thinking"><span class="message-label">FINMATE</span><p>Reading your accounts and working through the options…</p></div>`
  )
  $('#chat-input').value = ''
  button.disabled = true
  $('#conversation').scrollTop = $('#conversation').scrollHeight
  try {
    const result = await api('agent', { message: text, language: assistantLanguage })
    await sync(result.state)
    if (
      result.semester &&
      result.semester.revision === state.revision &&
      result.semester.marketVersion === state.market.version &&
      result.semester.today === baseScenario.points[0].date
    )
      semesterData = result.semester
    if (
      result.assessment &&
      result.assessment.revision === state.revision &&
      result.assessment.marketVersion === state.market.version
    ) {
      affordabilityResult = result.assessment
      affordabilityInput = {
        ...result.assessment.input,
        useScenario: !!(
          result.assessment.input.fxDrop ||
          result.assessment.input.incomeDelay ||
          result.assessment.input.rentIncrease
        ),
      }
      if (affordabilityInput.useScenario) {
        scenarioInput = {
          fxDrop: affordabilityInput.fxDrop,
          incomeDelay: affordabilityInput.incomeDelay,
          rentIncrease: affordabilityInput.rentIncrease,
        }
        scenarioResult = null
      }
    }
    $('#agent-thinking').remove()
    const trace = `<details class="agent-trace"><summary>${result.trace.length} financial tools used · ${result.mode === 'live' ? 'Live model' : 'Offline planner'}</summary>${result.trace.map(t => `<p><b>${escape(t.tool.replaceAll('_', ' '))}</b><br>${escape(t.summary)}</p>`).join('')}</details>`
    $('#conversation').insertAdjacentHTML(
      'beforeend',
      `<div class="agent-message"><span class="message-label">FINMATE · ${result.mode === 'live' ? 'LIVE AGENT' : 'OFFLINE PLANNER'}</span><p lang="${result.language === 'zh' ? 'zh-Hans' : 'en'}">${agentText(result.answer)}</p>${trace}${result.mission ? '<button class="agent-action" data-view="mission">Open tuition workflow ↗</button>' : ''}${result.draft ? `<button class="agent-action" data-agent-draft="${escape(result.draft.id)}">Review prepared plan <span>↗</span></button>` : result.family ? `<button class="agent-action" data-family-preview="${escape(result.family.previewDigest)}">Review family request choices <span>↗</span></button>` : result.semester ? '<button class="agent-action" data-view="plan">See my semester plan <span>↗</span></button>' : result.assessment ? '<button class="agent-action" data-action="purchase-forecast">See purchase forecast <span>↗</span></button>' : '<button class="agent-action" data-action="tuition">Explore tuition options <span>↗</span></button>'}</div>`
    )
    if (result.draft) agentDrafts.set(result.draft.id, result.draft)
    if (result.family) agentFamilyPreviews.set(result.family.previewDigest, result.family)
    render()
  } catch (error) {
    $('#agent-thinking')?.remove()
    $('#conversation').insertAdjacentHTML(
      'beforeend',
      `<div class="agent-message"><p>${escape(error.message)}</p></div>`
    )
  } finally {
    button.disabled = false
    $('#conversation').scrollTop = $('#conversation').scrollHeight
  }
}

const agentDrafts = new Map(),
  agentFamilyPreviews = new Map()

async function resetDemo() {
  try {
    const result = await api('demo/reset', {})
    await sync(result.state)
    transferDraft = { amount: 5000, from: 'CNY', to: 'EUR', route: 'student' }
    period = 'month'
    scenarioResult = null
    scenarioInput = { fxDrop: 0, incomeDelay: 0, rentIncrease: 0 }
    setupDraft = null
    setupStep = 1
    tuitionSource = state.profile.homeCurrency
    fundingPlans = []
    fundingRoute = null
    fundingBackups = null
    agentDrafts.clear()
    agentFamilyPreviews.clear()
    closeModal()
    navigate('overview')
    $('#conversation').innerHTML =
      '<div class="agent-message" id="initial-message"><span class="message-label">FINMATE · TODAY</span><p>Your demo is fresh. Ask me to plan tuition using CNY or explore a delayed income.</p><button class="agent-action" data-action="tuition">Explore tuition options <span>↗</span></button></div>'
    toast('Your simulated session has been reset.')
  } catch (error) {
    toast(error.message)
  }
}

async function demoAction(action) {
  try {
    if (action === 'demo-funding-gap') {
      const result = await api('demo/funding-gap', {})
      await sync(result.state)
      navigate('tuition')
      toast('CNY weakened by 5%. Explore a combined-currency plan.')
    }
    if (action === 'demo-deadline') {
      const result = await api('demo/deadline', {})
      await sync(result.state)
      navigate('tuition')
      toast('Tuition is due tomorrow. Slow routes are filtered out.')
    }
    if (action === 'demo-rates') {
      const result = await api('demo/rates', {})
      await sync(result.state)
      render()
      toast('CNY rate changed. Old quotes need fresh approval.')
    }
    if (action === 'expire-quote' && pendingAction) {
      await api('demo/expire', { draftId: pendingAction.id })
      toast('Quote expired. Try approving it to see the server block it.')
    }
    if (action === 'change-quote' && pendingAction) {
      await api('demo/rates', {})
      toast('Rate changed. This quote now requires a fresh review.')
    }
  } catch (error) {
    toast(error.message)
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button')
  if (!button) return
  if (button.dataset.jump) {
    const target = document.getElementById(button.dataset.jump)
    if (target?.tagName === 'DETAILS') target.open = true
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (button.dataset.view) {
    if ($('#modal').open) closeModal()
    navigate(button.dataset.view)
    return
  }
  if (button.dataset.period) {
    period = button.dataset.period
    render()
    return
  }
  if (button.dataset.tab) {
    activityTab = button.dataset.tab
    search = ''
    render()
    return
  }
  if (button.dataset.prompt) {
    sendMessage(button.dataset.prompt)
    return
  }
  if (button.dataset.scenario) {
    calculateScenario(button.dataset.scenario)
    return
  }
  if (button.dataset.affordPreset) {
    affordabilityPreset(button.dataset.affordPreset)
    return
  }
  if (button.dataset.action === 'use-spending-limit') {
    if (affordabilityResult?.maxAmount > 0) {
      $('#purchase-amount').value = affordabilityResult.maxAmount
      checkPurchase()
    }
    return
  }
  if (button.dataset.familyPreview) {
    familyRequest(agentFamilyPreviews.get(button.dataset.familyPreview))
    return
  }
  if (button.dataset.agentDraft) {
    showReview(agentDrafts.get(button.dataset.agentDraft))
    return
  }
  const action = button.dataset.action
  if (action === 'mission-prepare') {
    prepareTuitionMission()
    return
  }
  if (action === 'reference-refresh') {
    loadReference()
    return
  }
  if (action === 'assistant') openAssistant()
  if (action === 'close-assistant') closeAssistant()
  if (action === 'current-invoice') reviewSavedInvoice()
  if (action === 'student-setup') {
    if ($('#modal').open) closeModal()
    initializeSetup()
    navigate('setup')
  }
  if (action === 'purchase-forecast') {
    navigate('plan')
    $('#affordability-area').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (action === 'security-settings') securitySettings()
  if (action === 'setup-payment-pin') configurePaymentPin(pendingAction)
  if (action === 'configure-pin') configurePaymentPin()
  if (action === 'guardian-review') guardianReview()
  if (action === 'family-request') familyRequest()
  if (action === 'create-family-request') saveFamilyRequest()
  if (action === 'close') closeModal()
  if (action === 'tuition') {
    closeModal()
    navigate('tuition')
  }
  if (action === 'accounts') accounts()
  if (action === 'starting-balances') startingBalances()
  if (action === 'deposit') deposit()
  if (action === 'upload') upload()
  if (action === 'invoice') invoiceUpload()
  if (action === 'sample-invoice') extractFile(true)
  if (action === 'budget') editBudget()
  if (action === 'see-funding') {
    $('#funding-details').open = true
    loadFunding()
    $('#funding-area').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (action === 'retry-funding') loadFunding()
  if (action === 'prepare-funding')
    prepareReview({
      type: 'tuition-funding',
      sourceCurrency: tuitionSource,
      backupCurrencies: selectedBackups(),
      route: fundingRoute,
    })
  if (action === 'prepare-tuition')
    prepareReview({ type: 'tuition', sourceCurrency: tuitionSource, route: tuitionRoute })
  if (action === 'approve') approve()
  if (action === 'refresh-quote') refreshQuote()
  if (action === 'audit') {
    closeModal()
    await sync()
    activityTab = 'audit'
    navigate('activity')
  }
  if (action === 'reset') resetDemo()
  if (
    ['demo-deadline', 'demo-rates', 'demo-funding-gap', 'expire-quote', 'change-quote'].includes(
      action
    )
  )
    demoAction(action)
})

document.addEventListener('change', event => {
  if (event.target.id === 'family-source')
    document.querySelectorAll('[name=family-backup]').forEach(el => {
      el.disabled = el.value === event.target.value
      if (el.disabled) el.checked = false
    })
  if (event.target.closest('#family-form') && event.target.id !== 'family-confirm') {
    familyResult = null
    familySequence++
    if ($('#family-output'))
      $('#family-output').innerHTML =
        '<p class="plan-note">Choices changed. Preview again before creating a download.</p>'
  }
  if (event.target.id === 'family-confirm' && $('#create-family-request'))
    $('#create-family-request').disabled = !event.target.checked
  if (event.target.id === 'approval-checkbox') updateApprovalButton()
  if (event.target.id === 'use-purchase-scenario' && event.target.checked && $('#what-if'))
    $('#what-if').open = true
  if (['from-currency', 'to-currency'].includes(event.target.id)) updateQuotes()
  if (event.target.name === 'provider') {
    transferDraft.route = event.target.value
    updateQuotes()
  }
  if (event.target.id === 'tuition-source') {
    tuitionSource = event.target.value
    fundingBackups = null
    $('#funding-area').outerHTML = fundingSection()
    loadTuition()
  }
  if (event.target.name === 'backup-currency') {
    fundingBackups = [...document.querySelectorAll('[name=backup-currency]:checked')].map(
      input => input.value
    )
    loadFunding()
  }
  if (event.target.name === 'funding-route') {
    fundingRoute = event.target.value
    drawFunding()
  }
  if (event.target.name === 'tuition-route') {
    tuitionRoute = event.target.value
    drawTuition()
  }
})

let transferTimer

document.addEventListener('input', event => {
  if (event.target.id === 'send-amount') {
    clearTimeout(transferTimer)
    quoteSequence++
    $('#review-transfer').disabled = true
    $('#receive-amount').value = ''
    $('#transfer-routes').innerHTML = '<p class="empty-state">Updating your quote…</p>'
    transferTimer = setTimeout(() => {
      if (currentView === 'transfers') updateQuotes()
    }, 180)
  }
  if (event.target.id === 'activity-search') {
    search = event.target.value
    $('#activity-rows').innerHTML = activityRows()
  }
})

document.addEventListener('submit', event => {
  const id = event.target.id
  if (
    [
      'chat-form',
      'transfer-form',
      'upload-form',
      'invoice-extract-form',
      'invoice-verify-form',
      'budget-form',
      'scenario-form',
      'affordability-form',
      'guardian-form',
      'family-form',
      'payment-pin-form',
      'starting-balances-form',
      'deposit-form',
      'mission-form',
    ].includes(id)
  )
    event.preventDefault()
  if (id === 'chat-form') sendMessage($('#chat-input').value)
  if (id === 'transfer-form') prepareReview({ type: 'transfer', ...transferDraft })
  if (id === 'upload-form') importFile()
  if (id === 'invoice-extract-form') extractFile()
  if (id === 'invoice-verify-form') verifyFields()
  if (id === 'budget-form') saveBudget()
  if (id === 'scenario-form') calculateScenario()
  if (id === 'affordability-form') checkPurchase()
  if (id === 'guardian-form') saveGuardianReview()
  if (id === 'family-form') previewFamilyRequest()
  if (id === 'payment-pin-form') savePaymentPin()
  if (id === 'starting-balances-form') saveStartingBalances()
  if (id === 'deposit-form') saveDeposit()
  if (id === 'mission-form') calculateMission()
})

$('#modal').addEventListener('cancel', () => {
  pendingAction = null
  activeApproval = null
})

$('#profile-button').addEventListener('click', () => {
  if (!state || !semesterData) {
    toast('Your account is still loading. Try again in a moment.')
    return
  }
  openModal(
    `<h2 id="modal-title">Hey, ${escape(state.profile.name.split(/\s+/)[0])}.</h2><p>${escape(state.profile.name)} · ${escape(state.profile.university)}<br>${escape(state.profile.homeCity)} → ${escape(state.profile.studyCity)}</p><div class="receipt"><div class="receipt-row"><span>Financial activity</span><strong>Simulated funds only</strong></div><div class="receipt-row"><span>Agent mode</span><strong>${agentInfo.mode === 'live' ? escape(agentInfo.model) : 'Offline tool planner'}</strong></div><div class="receipt-row"><span>Semester through</span><strong>${displayDate(state.profile.semesterEnd)}</strong></div></div><p>${agentInfo.mode === 'live' ? 'Chat sends your messages and financial tool results to the configured model provider. Invoice extraction stays local.' : 'The offline planner uses the same calculation tools. Configure a provider to enable live chat.'}</p><button class="dark-button" data-action="accounts">Manage balances ↗</button><button class="secondary-button" data-action="student-setup">Edit my student plan ↗</button><button class="secondary-button" data-action="security-settings">Security settings ↗</button><button class="secondary-button" data-view="lab">Sandbox studio ↗</button><button class="secondary-button" data-action="reset">Reset demo data</button>`
  )
})

$('.skip-link').addEventListener('click', event => {
  event.preventDefault()
  $('#main').focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: 'instant' })
})

window.addEventListener('hashchange', () =>
  navigate(location.hash.slice(1), { historyMode: 'replace' })
)

function referenceStrip() {
  if (!referenceData)
    return `<div class="reference-strip"><span>ECB reference data</span><span>${escape(referenceError || 'Loading informational exchange rates…')}</span><button class="text-button" data-action="reference-refresh">Check reference ↻</button></div>`
  const r = referenceData
  return `<aside class="reference-strip" aria-label="Informational exchange rates"><a href="${escape(r.sourceUrl)}" target="_blank" rel="noopener">ECB reference · ${escape(r.observationDate)}</a><span>1 EUR = ${r.perEUR.GBP.toFixed(5)} GBP / ${r.perEUR.CNY.toFixed(4)} CNY</span><span class="reference-status ${r.freshness === 'stale' ? 'stale' : ''}">${r.connection === 'offline' ? 'Offline fallback · ' : ''}${r.freshness === 'stale' ? 'Stale observation' : 'Latest checked observation'}</span><small>Information only. Payment quotes use simulated rates.</small></aside>`
}

async function loadReference() {
  try {
    referenceData = (await api('reference-rates')).reference
    referenceError = ''
  } catch {
    referenceError = 'Reference feed unavailable. Payment planning remains simulated.'
  }
  const old = document.querySelector('.reference-strip')
  if (old) old.outerHTML = referenceStrip()
}

function mission() {
  return `${welcome()}${pageHeading(bilingual('ONE PROBLEM. A CLEAR PLAN.', '一个问题，一份清晰的计划'), bilingual('Take care<br>of <em>tuition.</em>', '安排好<br><em>学费。</em>'), bilingual('Choose the accounts you may use. We’ll check the deadline, protect your living costs and guide you through the remaining steps.', '选择可以使用的账户。我们会检查截止日期、保护生活费用，并说明下一步。'), '<button class="text-button" data-view="tuition">View tuition details ↗</button>')}<div class="mission-layout"><aside class="mission-context"><span class="eyebrow">${bilingual('YOUR TUITION', '您的学费')}</span><strong class="mission-amount">${money(state.invoice.amount, state.invoice.currency)}</strong><p>${escape(state.invoice.recipient)}</p><dl><dt>${bilingual('Due date', '截止日期')}</dt><dd>${displayDate(state.invoice.due)}</dd><dt>${bilingual('Balance source', '余额来源')}</dt><dd>${accountSource()}</dd><dt>${bilingual('Protected EUR reserve', '受保护的欧元储备')}</dt><dd>${money(monthlyEssentials() + state.budget.buffer)}</dd></dl><button class="text-button" data-action="current-invoice">${bilingual('Check or correct the invoice', '检查或更正发票')} ↗</button><button class="text-button" data-action="accounts">${bilingual('Review my balances', '检查我的余额')} ↗</button><p class="plan-note">${bilingual('This is a planning sandbox. Your own balances are self-reported. No real bank is connected.', '这是规划沙盒。您输入的余额未经银行验证。没有连接真实银行。')}</p></aside><section class="mission-work"><form id="mission-form"><div class="mission-fields"><div class="field"><label for="mission-source">${bilingual('Use this account first', '优先使用此账户')}</label><select id="mission-source">${currencyOptions(missionInputState.sourceCurrency)}</select></div><div class="field"><label for="mission-delay">${bilingual('Expected income delayed by (days)', '预计收入延迟（天）')}</label><input id="mission-delay" type="number" min="0" max="60" step="1" value="${missionInputState.incomeDelay}" required></div></div><fieldset class="mission-backups"><legend>${bilingual('Backup accounts I permit', '我允许使用的备用账户')}</legend>${['EUR', 'GBP', 'CNY'].map(c => `<label><input name="mission-backup" type="checkbox" value="${c}" ${c === missionInputState.sourceCurrency ? 'disabled' : ''} ${missionInputState.backupCurrencies.includes(c) ? 'checked' : ''}> ${c}${c === 'EUR' ? bilingual(' · only above my living reserve', ' · 仅生活储备以外的资金') : ''}</label>`).join('')}</fieldset><p class="plan-note">${bilingual('Expected income is excluded from available payment funds, even with zero delay. Update the invoice to change its deadline.', '即使没有延迟，预计收入也不计入可支付资金。请修改发票以更改截止日期。')}</p><button class="dark-button" id="mission-calculate" type="submit">${bilingual('Build my tuition plan', '生成学费计划')} ↗</button></form><div id="mission-output" aria-live="polite">${missionData ? missionResultHTML(missionData) : `<p class="mission-empty">${bilingual('Your next steps will appear here. Choose your accounts, then build the plan.', '选择账户并生成计划，即可查看下一步。')}</p>`}</div></section></div>${footer()}`
}

function readMissionInput() {
  return {
    sourceCurrency: $('#mission-source').value,
    backupCurrencies: [...document.querySelectorAll('[name=mission-backup]:checked')]
      .map(e => e.value)
      .filter(c => c !== $('#mission-source').value),
    incomeDelay: Number($('#mission-delay').value),
  }
}

function missionChanges(old, plan) {
  if (!old) return ''
  const changes = []
  if (old.revision !== plan.revision)
    changes.push(
      bilingual('Balances, invoice or saved settings changed.', '余额、发票或已保存设置发生变化。')
    )
  if (old.marketVersion !== plan.marketVersion)
    changes.push(bilingual('Simulated exchange rates changed.', '模拟汇率发生变化。'))
  if (old.day !== plan.day)
    changes.push(
      bilingual('Arrival estimates were recalculated for today.', '已根据今天重新计算到达日期。')
    )
  if (JSON.stringify(old.input) !== JSON.stringify(plan.input))
    changes.push(
      bilingual(
        'Your permitted accounts or income-delay assumption changed.',
        '您允许使用的账户或收入延迟假设发生变化。'
      )
    )
  if (
    old.recommended?.route !== plan.recommended?.route ||
    old.recommended?.type !== plan.recommended?.type
  )
    changes.push(bilingual('The recommended payment route changed.', '推荐的付款方式发生变化。'))
  if (!changes.length) return ''
  return `<div class="mission-change"><strong>${bilingual('What changed', '变化内容')}</strong>${changes.map(c => `<p>${c}</p>`).join('')}<p>${bilingual('Previous payment consent does not carry over. Review and approve any new draft separately.', '之前的付款同意不会沿用。请单独检查并批准新的付款草案。')}</p></div>`
}

function missionStepText(step, plan) {
  if (assistantLanguage !== 'zh') return step
  const q = plan.recommended,
    copy = {
      balances: ['输入起始余额', '请用您自己的规划余额替换示例数据。这不代表银行验证。'],
      invoice: ['核对学费发票', '请检查收款人、账户、金额、币种、付款参考及截止日期。'],
      guardian: ['独立检查发票变更', '请通过您信任的学校联系方式核对差异。'],
      funding: [
        '所选账户没有符合条件的付款方式',
        '所选账户余额不足、到达时间晚于截止日期或需要动用受保护的欧元生活储备。请检查备用账户、发票截止日期及余额。',
      ],
      income: [
        '未来收入尚不可用',
        `收入延迟 ${plan.input.incomeDelay} 天属于规划假设。预计收入不计入当前可支付资金。`,
      ],
      review: [
        '核对准确付款',
        q
          ? `模拟费用 ${q.costEUR.toFixed(2)} EUR，预计到达 ${q.arrival}。支付后保留 ${q.remainingEUR.toFixed(2)} EUR，受保护生活储备为 ${plan.protectedEUR.toFixed(2)} EUR。`
          : '请先解决检查项目。',
      ],
      approval: [
        '单独使用付款 PIN 批准',
        '生成计划不代表批准。余额、发票、预算或模拟汇率变化后，必须重新检查并批准。',
      ],
      receipt: ['检查收据和审计记录', '模拟付款只记录一次。重试会返回同一张收据。'],
    }
  const pair = copy[step.id]
  return pair ? { ...step, title: pair[0], reason: pair[1] } : step
}

function missionResultHTML(plan) {
  const q = plan.recommended
  return `${missionChanges(missionPrevious, plan)}<div class="mission-verdict ${plan.status}"><span class="eyebrow">${plan.status === 'paid' ? bilingual('ALREADY PAID', '已支付') : plan.status === 'ready' ? bilingual('READY FOR YOUR REVIEW', '可以检查计划') : bilingual('A FEW THINGS TO RESOLVE', '有待解决的问题')}</span><h2>${plan.status === 'paid' ? bilingual('Your receipt is ready.', '收据已生成。') : plan.status === 'ready' ? bilingual('A route that fits your deadline.', '符合截止日期的付款方式。') : bilingual('Let’s clear the blockers.', '先解决这些问题。')}</h2></div>${q ? `<div class="mission-payment"><div><span>${bilingual('Recommended route', '推荐方式')}</span><strong>${escape(q.provider)}</strong></div><div><span>${bilingual('Total simulated fees', '模拟总费用')}</span><strong>${money(q.costEUR)}</strong></div><div><span>${bilingual('Estimated arrival', '预计到达')}</span><strong>${displayDate(q.arrival)}</strong></div><div><span>${bilingual('EUR after payment', '支付后欧元余额')}</span><strong>${money(q.remainingEUR)}</strong></div></div>` : ''}<ol class="mission-steps">${plan.steps.map((step, i) => `<li><span class="plan-num">${String(i + 1).padStart(2, '0')}</span><div><h3>${escape(missionStepText(step, plan).title)}</h3><p>${escape(missionStepText(step, plan).reason)}</p></div>${step.id === 'review' ? '' : step.view ? `<button class="text-button" data-view="${step.view}">${bilingual('Open', '打开')} ↗</button>` : step.action && !(step.id === 'approval' && securityInfo.hasPin) ? `<button class="text-button" data-action="${step.action}">${bilingual('Review', '检查')} ↗</button>` : ''}</li>`).join('')}</ol>${plan.status === 'ready' ? `<label class="approval-check"><input type="checkbox" id="mission-confirm"><span>${bilingual('I reviewed the selected accounts, fees, deadline and living reserve. Prepare an exact payment draft for separate approval.', '我已检查所选账户、费用、截止日期及生活储备。生成准确的付款草案，以便单独批准。')}</span></label><button id="mission-prepare" class="dark-button" data-action="mission-prepare" disabled>${bilingual('Review exact payment', '检查准确付款')} ↗</button>` : ''}<details class="mission-alternatives"><summary>${bilingual('Why other routes were not selected', '为什么没有选择其他方式')}</summary>${plan.alternatives.map(a => `<div class="mission-alternative"><strong>${escape(a.provider)}${a.type === 'tuition-funding' ? ' · combined' : ''}</strong><span>${money(a.costEUR)} · ${displayDate(a.arrival)}</span><p>${a.eligible ? bilingual('Eligible. Ranked by fees for your selected account order.', '符合条件。按所选账户顺序的费用排序。') : a.reasons.map(escape).join(' · ')}</p></div>`).join('') || '<p>Resolve the invoice checks before comparing routes.</p>'}</details><p class="plan-note">${bilingual('All payments and provider quotes are simulated. No funds are moved by building this plan.', '所有付款和服务商报价均为模拟。生成计划不会转移资金。')}</p>`
}

async function calculateMission() {
  missionInputState = readMissionInput()
  const seq = ++missionSequence
  const previous = missionData || missionPrevious
  missionData = null
  $('#mission-calculate').disabled = true
  $('#mission-output').innerHTML =
    '<p class="mission-empty">Checking balances, deadline and living reserve…</p>'
  try {
    await sync()
    const { plan } = await api('mission/plan', missionInputState)
    if (seq !== missionSequence || currentView !== 'mission') return
    missionPrevious = previous
    missionData = plan
    $('#mission-output').innerHTML = missionResultHTML(plan)
  } catch (e) {
    if (seq === missionSequence && $('#mission-output'))
      $('#mission-output').innerHTML =
        `<p class="error">${escape(e.message)}</p><button class="secondary-button" data-view="tuition">Use tuition controls ↗</button>`
  } finally {
    if ($('#mission-calculate')) $('#mission-calculate').disabled = false
  }
}

async function prepareTuitionMission() {
  if (!missionData || !$('#mission-confirm')?.checked) return
  const plan = missionData
  $('#mission-prepare').disabled = true
  try {
    const { draft } = await api('mission/prepare', {
      ...plan.input,
      planDigest: plan.planDigest,
      baseRevision: plan.revision,
      marketVersion: plan.marketVersion,
      confirmed: true,
    })
    showReview(draft)
    await sync()
  } catch (e) {
    missionPrevious = plan
    missionData = null
    if ($('#mission-output'))
      $('#mission-output').innerHTML =
        `<p class="error">${escape(e.message)}</p><p class="plan-note">Rebuild the plan before reviewing another payment.</p>`
  }
}

document.addEventListener('change', event => {
  if (event.target.id === 'assistant-language') {
    assistantLanguage = event.target.value === 'zh' ? 'zh' : 'en'
    localStorage.setItem('finmate_language', assistantLanguage)
    $('#chat-input').placeholder = bilingual(
      'Ask a question about your money…',
      '询问余额、学费或生活预算…'
    )
    render()
  }
  if (event.target.id === 'mission-confirm' && $('#mission-prepare'))
    $('#mission-prepare').disabled = !event.target.checked
})

document.addEventListener('input', event => {
  if (!event.target.closest('#mission-form')) return
  if (event.target.id === 'mission-source')
    document.querySelectorAll('[name=mission-backup]').forEach(e => {
      e.disabled = e.value === event.target.value
      if (e.disabled) e.checked = false
    })
  missionInputState = readMissionInput()
  missionPrevious = missionData || missionPrevious
  missionData = null
  missionSequence++
  if ($('#mission-output'))
    $('#mission-output').innerHTML =
      `<p class="mission-empty">${bilingual('Choices changed. Build a fresh plan before preparing payment.', '选择已更改。请重新生成计划，再准备付款。')}</p>`
  if ($('#mission-calculate')) $('#mission-calculate').disabled = false
})

try {
  const boot = await api('bootstrap')
  csrf = boot.csrf
  securityInfo = boot.security
  agentInfo = boot.agent
  await sync(boot.state)
  $('#assistant-language').value = assistantLanguage
  $('#chat-input').placeholder = bilingual(
    'Ask a question about your money…',
    '询问余额、学费或生活预算…'
  )
  loadReference()
  tuitionSource = state.profile.homeCurrency
  currentView = [
    'overview',
    'plan',
    'tuition',
    'transfers',
    'activity',
    'lab',
    'setup',
    'mission',
  ].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'overview'
  $('#initial-message p').textContent = state.invoice.paid
    ? 'Your tuition is paid in the sandbox. Explore your cash flow or inspect the approval receipt.'
    : 'Tuition is coming up. I can compare arrival dates and fees while keeping your living budget protected. Ask me to plan it using CNY.'
  if (currentView === 'setup') initializeSetup()
  render()
} catch (error) {
  $('#main').innerHTML =
    `<h1 class="view-heading">Let’s reconnect.</h1><p class="error">${escape(error.message)}</p><p>Reload the page to try again. If you are running FinMate locally, check that the server is running.</p>`
  $('#agent-mode').textContent = 'Disconnected'
}

function selectedBackups() {
  return fundingBackups ?? ['CNY', 'GBP'].filter(c => c !== tuitionSource)
}

function fundingSection() {
  return `<section class="funding-section" id="funding-area"><div class="section-head"><div><span class="eyebrow">FUNDING-GAP RESCUE</span><h2 class="funding-title">Need more than one account?</h2></div><span class="funding-symbol" aria-hidden="true">↗</span></div><p class="funding-description">Choose which other accounts may help cover tuition. You’ll see every contribution and fee before reviewing the whole payment.</p><details id="funding-details"><summary>Choose additional funding accounts <span>↗</span></summary><fieldset class="funding-backups"><legend>Use ${tuitionSource} first. Which backups may contribute?</legend>${[
    'EUR',
    'GBP',
    'CNY',
  ]
    .filter(c => c !== tuitionSource)
    .map(
      c =>
        `<label><input type="checkbox" name="backup-currency" value="${c}" ${selectedBackups().includes(c) ? 'checked' : ''}>${c === 'EUR' ? 'Spare euros above my living reserve' : `${c} savings`}</label>`
    )
    .join(
      ''
    )}</fieldset><div id="funding-plans"><p class="empty-state">Calculating contributions…</p></div><p id="funding-error" class="error" role="status"></p><div id="funding-retry" hidden><button class="secondary-button" data-action="retry-funding">Retry calculation ↻</button></div><div class="funding-total" id="funding-total"></div><div class="transfer-bottom"><p>Your preferred currency is used first, then the selected backups. Every contribution is shown before approval. Protected euro funds stay untouched.</p><button id="prepare-funding" class="dark-button" data-action="prepare-funding" disabled>Review combined plan ↗</button></div></details></section>`
}

async function loadFunding() {
  const sequence = ++fundingSequence,
    source = tuitionSource,
    backups = selectedBackups(),
    revision = state.revision,
    market = state.market.version
  if (!$('#prepare-funding')) return
  fundingPlans = []
  fundingRoute = null
  $('#prepare-funding').disabled = true
  $('#funding-retry').hidden = true
  $('#funding-plans').innerHTML = '<p class="empty-state">Calculating contributions…</p>'
  $('#funding-total').innerHTML = ''
  $('#funding-error').textContent = ''
  try {
    const { plans } = await api('tuition/funding', {
      sourceCurrency: source,
      backupCurrencies: backups,
    })
    if (
      sequence !== fundingSequence ||
      currentView !== 'tuition' ||
      source !== tuitionSource ||
      revision !== state.revision ||
      market !== state.market.version
    )
      return
    fundingPlans = plans
    fundingRoute = plans.find(p => p.eligible)?.route || null
    drawFunding()
    if (!tuitionRoutes.some(q => q.eligible)) $('#funding-details').open = true
  } catch (error) {
    if (sequence === fundingSequence && $('#funding-error')) {
      $('#funding-error').textContent = error.message
      $('#funding-plans').innerHTML = ''
      $('#funding-total').innerHTML = ''
      fundingRoute = null
      $('#funding-details').open = true
      $('#funding-retry').hidden = false
    }
  }
}

function drawFunding() {
  const selected = fundingPlans.find(p => p.route === fundingRoute),
    recommended = fundingPlans.find(p => p.eligible)
  $('#funding-error').textContent = ''
  $('#funding-plans').innerHTML = fundingPlans
    .map(
      p =>
        `<label class="route ${p.route === fundingRoute ? 'selected' : ''} ${p.eligible ? '' : 'ineligible'}"><input type="radio" name="funding-route" value="${p.route}" ${p.route === fundingRoute ? 'checked' : ''} ${p.eligible ? '' : 'disabled'}><div><strong>${escape(p.provider)}${p.route === recommended?.route ? '<span class="best-label">LOWEST FEE</span>' : ''}</strong><div class="route-meta">${p.legs.length} account${p.legs.length === 1 ? '' : 's'} · arrives ${displayDate(p.arrival)} · ${money(p.costEUR)} total fees</div>${p.reasons.length ? `<p class="route-rejection">${p.reasons.map(escape).join(' · ')}</p>` : ''}</div><div class="route-amount">${p.eligible || !p.shortfall ? money(state.invoice.amount, state.invoice.currency) : money(p.shortfall, state.invoice.currency)}<small>${p.eligible ? 'Tuition covered' : p.shortfall ? 'Funding shortfall' : 'Not eligible'}</small></div></label>`
    )
    .join('')
  $('#prepare-funding').disabled = !selected
  $('#funding-total').innerHTML = selected
    ? `<div class="section-head"><h2>Every contribution, explained.</h2><span class="eyebrow">ONE APPROVAL</span></div>${selected.legs.map((l, i) => `<div class="funding-contribution"><span class="plan-num">0${i + 1}</span><div><strong>${l.from} ${i === 0 ? '· preferred account' : '· backup account'}</strong><p>Use ${money(l.sourceAmount, l.from)} · fee ${money(l.fee, l.from)}</p><p>Balance after payment: ${money(selected.afterBalances[l.from], l.from)}</p></div><strong>${money(l.received, l.to)}</strong></div>`).join('')}<div class="funding-protection"><span class="status-dot"></span><p>${money(selected.remainingEUR)} remains in euros against ${money(selected.protectedEUR)} of protected living funds.${selected.primaryShortfall > 0 ? ` Backup accounts fill a ${money(selected.primaryShortfall, state.invoice.currency)} gap.` : ''}</p></div>`
    : '<p class="plan-note">These accounts cannot cover the full payment safely. Choose another backup or arrange additional funding. No partial payment will be executed.</p>'
}

function affordabilitySection() {
  const today = baseScenario.points[0].date,
    last = baseScenario.points.at(-1).date
  const i = affordabilityInput || {
    amount: 180,
    currency: 'EUR',
    date: today,
    label: 'Weekend trip',
    useScenario: false,
  }
  return `<section class="affordability-section" id="affordability-area"><div class="section-head"><div><span class="eyebrow">A LITTLE ROOM FOR YOU</span><h2>Can I afford this?</h2></div><span class="affordability-flourish" aria-hidden="true">↗</span></div><p class="view-description">The trip, the new laptop, the ticket home. Check how one purchase would change your next 60 days, before you commit.</p><form id="affordability-form"><div class="purchase-price"><div class="field"><label for="purchase-amount">How much?</label><input id="purchase-amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" value="${escape(i.amount)}" required></div><div class="field"><label for="purchase-currency">Paying account</label><select id="purchase-currency" name="currency">${['EUR', 'GBP', 'CNY'].map(c => `<option ${i.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div><div class="purchase-details"><div class="field"><label for="purchase-label">What’s it for?</label><input id="purchase-label" name="label" maxlength="100" value="${escape(i.label)}" required></div><div class="field"><label for="purchase-date">When?</label><input id="purchase-date" name="date" type="date" min="${today}" max="${last}" value="${escape(i.date)}" required></div></div><label class="purchase-scenario"><input id="use-purchase-scenario" name="useScenario" type="checkbox" ${i.useScenario ? 'checked' : ''}> Apply the stress-test values below</label><div class="purchase-actions"><button class="dark-button" id="check-purchase" type="submit">Check my purchase ↗</button><span>Planning only. Your money stays put.</span></div></form><div class="purchase-presets"><span class="eyebrow">TRY IT</span><button data-afford-preset="trip">€180 weekend trip</button><button data-afford-preset="laptop">€1,400 laptop</button></div><div id="affordability-output" role="status" aria-live="polite">${affordabilityResult ? affordabilityHTML(affordabilityResult) : '<p class="plan-note">The limit covers your essentials, verified tuition and emergency buffer. Expected income payments are left out until they arrive.</p>'}</div></section>`
}

function affordabilityHTML(r) {
  const title = {
    comfortable: 'Room to enjoy it.',
    tight: 'It fits. Keep a little watch.',
    shortfall: 'A little too much, for now.',
    verify: 'Let’s verify tuition first.',
  }[r.status]
  return `<div class="purchase-verdict ${r.status}"><span class="eyebrow">${{ comfortable: 'COMFORTABLE', tight: 'TIGHT', shortfall: 'WOULD LEAVE A SHORTFALL', verify: 'INVOICE VERIFICATION NEEDED' }[r.status]}</span><h3>${title}</h3><p>${escape(r.reason)}</p></div><div class="purchase-ledger"><div><span>Conservative spending limit · ${r.input.currency}</span><strong>${r.maxAmount === null ? 'Verify invoice' : money(r.maxAmount, r.input.currency)}</strong></div><div><span>Lowest balance before → after</span><strong>${money(r.minBefore)} <span aria-hidden="true">→</span> ${money(r.minAfter)}</strong></div><div><span>Emergency buffer</span><strong>${money(r.buffer)}</strong></div><div><span>Protected euro essentials + buffer</span><strong>${money(r.protectedEUR)}</strong></div></div><div class="purchase-chart-legend"><span><i></i>Before purchase</span><span><i></i>After purchase</span></div>${affordabilityGraph(r)}<p class="plan-note">${escape(r.input.label)} · ${money(r.input.amount, r.input.currency)} on ${displayDate(r.input.date)}. This chart excludes expected income.${r.input.fxDrop || r.input.incomeDelay || r.input.rentIncrease ? ` Applied stress: CNY −${r.input.fxDrop}%, expected income +${r.input.incomeDelay} days, rent +${money(r.input.rentIncrease)}.` : ''}</p>${r.status === 'shortfall' && r.maxAmount > 0 ? '<button class="secondary-button" data-action="use-spending-limit">Try the spending limit ↗</button>' : ''}${r.suggestedDate ? `<p class="purchase-date-note">Recheck after <b>${displayDate(r.suggestedDate)}</b>, ${escape(r.suggestedDateCondition.toLowerCase())}</p>` : ''}<details class="assumptions"><summary>How we worked this out</summary>${r.assumptions.map(a => `<p>${escape(a)}</p>`).join('')}<p>Saved monthly essentials ${money(r.baseline.assumptions.monthlyEssentials)}. Buffer ${money(r.buffer)}. Combined funds include all currencies; payment routes and deadlines need a separate planner check.</p></details>`
}

function affordabilityGraph(r) {
  const all = [...r.baseline.points, ...r.proposed.points].map(p => p.balance),
    max = Math.ceil(Math.max(...all, r.buffer) / 1000) * 1000 + 300,
    min = Math.floor(Math.min(...all, r.buffer) / 1000) * 1000 - 300
  const y = v => 112 - ((v - min) / (max - min)) * 86,
    path = points => points.map((p, i) => `${43 + (i / 60) * 580},${y(p.balance)}`).join(' ')
  return `<svg class="chart scenario-chart purchase-chart" viewBox="0 0 660 150" preserveAspectRatio="none" role="img" aria-label="60-day purchase comparison excluding expected scholarship. Lowest combined balance before ${money(r.minBefore)}; after ${money(r.minAfter)}; buffer ${money(r.buffer)}."><path class="grid" d="M43 26h580M43 69h580M43 112h580"/><line x1="43" x2="623" y1="${y(r.buffer)}" y2="${y(r.buffer)}" stroke="#bc8c7c" stroke-dasharray="3 5"/><polyline class="purchase-before" points="${path(r.baseline.points)}"/><polyline class="purchase-after" points="${path(r.proposed.points)}"/><text x="0" y="29">€${(max / 1000).toFixed(1)}k</text><text x="0" y="115">€${(min / 1000).toFixed(1)}k</text><text x="43" y="143">Today</text><text x="333" y="143" text-anchor="middle">${displayDate(r.baseline.points[30].date)}</text><text x="623" y="143" text-anchor="end">${displayDate(r.baseline.points.at(-1).date)}</text><text x="611" y="${y(r.buffer) - 6}" text-anchor="end">Buffer</text></svg>`
}

function readPurchase() {
  const data = Object.fromEntries(new FormData($('#affordability-form')))
  return { ...data, amount: Number(data.amount), useScenario: !!data.useScenario }
}

async function checkPurchase() {
  affordabilityInput = readPurchase()
  const { useScenario, ...input } = affordabilityInput
  if (useScenario) {
    const data = Object.fromEntries(new FormData($('#scenario-form')))
    for (const key of Object.keys(data)) input[key] = Number(data[key])
  }
  const sequence = ++affordabilitySequence,
    revision = state.revision,
    market = state.market.version
  affordabilityResult = null
  $('#check-purchase').disabled = true
  $('#affordability-output').innerHTML =
    '<p class="plan-note">Checking tuition, essentials and your reserve…</p>'
  try {
    const { assessment, state: nextState } = await api('affordability', input)
    if (
      sequence !== affordabilitySequence ||
      revision !== state.revision ||
      market !== state.market.version
    )
      return
    state = nextState
    affordabilityResult = assessment
    if (currentView === 'plan') $('#affordability-output').innerHTML = affordabilityHTML(assessment)
  } catch (error) {
    if (sequence === affordabilitySequence && currentView === 'plan')
      $('#affordability-output').innerHTML = `<p class="error">${escape(error.message)}</p>`
  } finally {
    if (sequence === affordabilitySequence && $('#check-purchase'))
      $('#check-purchase').disabled = false
  }
}

function affordabilityPreset(name) {
  $('#purchase-label').value = name === 'trip' ? 'Weekend trip' : 'New laptop'
  $('#purchase-amount').value = name === 'trip' ? 180 : 1400
  $('#purchase-currency').value = 'EUR'
  checkPurchase()
}

document.addEventListener('input', event => {
  if (event.target.closest('#affordability-form')) {
    affordabilityInput = readPurchase()
    affordabilityResult = null
    affordabilitySequence++
    $('#check-purchase').disabled = false
    $('#affordability-output').innerHTML =
      '<p class="plan-note">Purchase details changed. Check again for an updated limit.</p>'
  }
})

document.addEventListener('input', event => {
  if (event.target.closest('#scenario-form')) {
    scenarioSequence++
    scenarioInput = Object.fromEntries(
      [...new FormData($('#scenario-form'))].map(([key, value]) => [key, Number(value)])
    )
    scenarioResult = null
    $('#scenario-output').innerHTML =
      '<p class="plan-note">Values changed. Select “See what changes” to update this forecast.</p>'
    if ($('#use-purchase-scenario')?.checked) {
      affordabilityResult = null
      affordabilitySequence++
      $('#check-purchase').disabled = false
      $('#affordability-output').innerHTML =
        '<p class="plan-note">Stress assumptions changed. Check your purchase again.</p>'
    }
  }
})

function actionRows(actions) {
  return actions.length
    ? actions
        .map(
          a =>
            `<div class="semester-action"><time datetime="${escape(a.date)}"><span>${new Date(a.date + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short' })}</span><strong>${new Date(a.date + 'T12:00:00Z').getUTCDate()}</strong></time><div><h3>${escape(a.title)}</h3><p>${escape(a.reason)}</p></div><button class="text-button" data-view="${a.view}" aria-label="Open ${escape(a.title)}">↗</button></div>`
        )
        .join('')
    : '<p class="plan-note">No dated actions yet. Add your budget, income and tuition to start planning.</p>'
}

function semesterSection() {
  const s = semesterData
  return `<section class="semester-section" id="semester-plan"><div class="section-head"><div><span class="eyebrow">ONE PLAN. THE WHOLE SEMESTER.</span><h2>Your time abroad, mapped out.</h2></div><button class="text-button" data-action="student-setup">${state.profile.setupComplete ? 'Edit my plan' : 'Make it mine'} ↗</button></div><p class="view-description">${escape(state.profile.university)} · ${escape(state.profile.studyCity)} · through ${displayDate(s.end)}. These are reminders to review, with you in control of every payment.</p><div class="semester-projection"><div><span class="eyebrow">LOWEST WITH EXPECTED INCOME</span><strong>${money(s.projection.minBalance)}</strong></div><div class="${s.conservativeMin < state.budget.buffer ? 'at-risk' : ''}"><span class="eyebrow">LOWEST WITHOUT EXPECTED INCOME</span><strong>${money(s.conservativeMin)}</strong>${s.conservativeMin < state.budget.buffer ? '<small class="projection-note">Below your saved emergency buffer</small>' : ''}</div></div><div class="semester-dates">${actionRows(s.actions.slice(0, 6))}</div>${s.actions.length > 6 ? `<details class="semester-more"><summary>See ${s.actions.length - 6} more dates ↗</summary>${actionRows(s.actions.slice(6))}</details>` : ''}<details class="assumptions"><summary>How this semester plan works</summary>${s.assumptions.map(a => `<p>${escape(a)}</p>`).join('')}</details></section>`
}

function initializeSetup() {
  setupDraft = {
    profile: structuredClone(state.profile),
    budget: { ...state.budget },
    schedule: { ...state.schedule },
    incomes: structuredClone(state.incomes),
    invoice: { ...state.invoice },
    baseRevision: state.revision,
  }
  setupStep = 1
}

function setupField(id, label, value, type = 'text', extra = '') {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${escape(value)}" ${extra} required></div>`
}

function setupSelect(id, label, value, options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(v => `<option ${v === value ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`
}

function setup() {
  const d = setupDraft,
    p = d.profile,
    today = baseScenario.points[0].date,
    end = new Date(Date.parse(today) + 180 * 86400000).toISOString().slice(0, 10)
  let fields = ''
  if (setupStep === 1)
    fields = `<span class="eyebrow">01 · YOUR LIFE ABROAD</span><h2>A little about you.</h2><p>Tell us where you’re studying and how far ahead to plan. Accounts and rates remain simulated; living costs are planned in euros.</p><div class="setup-grid">${setupField('student-name', 'Your name', p.name, 'text', 'maxlength="100"')}${setupField('student-university', 'University', p.university, 'text', 'maxlength="100"')}${setupField('student-home', 'Home city', p.homeCity, 'text', 'maxlength="100"')}${setupField('student-study', 'Study city', p.studyCity, 'text', 'maxlength="100"')}${setupSelect('student-currency', 'Preferred funding currency', p.homeCurrency, ['EUR', 'GBP', 'CNY'])}${setupField('student-end', 'Semester ends', p.semesterEnd, 'date', `min="${new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10)}" max="${end}"`)}</div>`
  if (setupStep === 2)
    fields = `<span class="eyebrow">02 · THE EVERYDAY & THE INCOME</span><h2>Room for real life.</h2><p>Your monthly essentials and emergency buffer stay protected in euros. Expected income is a forecast, never a credit to your account.</p><div class="setup-grid">${[
      ['rent', 'Rent & bills'],
      ['groceries', 'Groceries'],
      ['transport', 'Transport'],
      ['other', 'Everything else'],
      ['buffer', 'Emergency buffer'],
    ]
      .map(([key, label]) =>
        setupField(
          'setup-' + key,
          label + ' (€)',
          d.budget[key],
          'number',
          'min="0" max="100000" step="0.01"'
        )
      )
      .join(
        ''
      )}${setupField('setup-rent-day', 'Rent payment day each month', d.schedule.rentDay, 'number', 'min="1" max="31" step="1"')}</div><div class="section-head setup-income-head"><h3>What money are you expecting?</h3><button type="button" class="text-button" data-setup-action="add-income" ${d.incomes.length >= 5 ? 'disabled' : ''}>Add income ↗</button></div><div id="setup-income-list">${d.incomes.length ? d.incomes.map((i, index) => `<fieldset class="setup-income"><legend>Income ${index + 1}</legend><div class="setup-income-fields">${setupField('income-label-' + index, 'Source', i.label, 'text', 'maxlength="80"')}${setupField('income-amount-' + index, 'Monthly amount', i.amount, 'number', 'min="0" max="100000" step="0.01"')}${setupSelect('income-currency-' + index, 'Currency', i.currency, ['EUR', 'GBP', 'CNY'])}${setupField('income-day-' + index, 'Payment day', i.payDay, 'number', 'min="1" max="31" step="1"')}</div><button type="button" class="text-button" data-setup-action="remove-income" data-income-index="${index}">Remove source ×</button></fieldset>`).join('') : '<p class="plan-note">No expected income. Your plan will rely on current balances only.</p>'}</div><p class="plan-note">Days 29–31 move to the last day in shorter months. A zero amount disables that source. You can add up to five sources.</p>`
  if (setupStep === 3)
    fields = `<span class="eyebrow">03 · ONE LAST LOOK</span><h2>The big dates, checked.</h2><p>Your university profile and payment recipient are separate. Check the invoice itself before saving a tuition commitment.</p>${state.invoice.paid ? `<div class="receipt"><div class="receipt-row"><span>Tuition paid in the sandbox</span><strong>${money(state.invoice.amount, state.invoice.currency)}</strong></div><p>This invoice stays paid. Use Read an invoice in Tuition when you have another one.</p></div>` : `<div class="setup-grid">${setupField('setup-recipient', 'Invoice recipient', d.invoice.recipient, 'text', 'maxlength="160"')}${setupField('setup-account', 'Recipient account (simulation)', d.invoice.account, 'text', 'maxlength="160"')}${setupField('setup-reference', 'Invoice reference', d.invoice.reference, 'text', 'maxlength="160"')}${setupField('setup-tuition', 'Tuition amount', d.invoice.amount, 'number', 'min="0.01" max="1000000" step="0.01"')}${setupSelect('setup-tuition-currency', 'Tuition currency', d.invoice.currency, ['EUR', 'GBP', 'CNY'])}${setupField('setup-due', 'Tuition deadline', d.invoice.due, 'date', `min="${today}" max="${new Date(Date.parse(today) + 365 * 86400000).toISOString().slice(0, 10)}"`)}</div>`}<div class="setup-review"><div><span>Student</span><strong>${escape(p.name)} · ${escape(p.university)}</strong></div><div><span>Monthly essentials + buffer</span><strong>${money(d.budget.rent + d.budget.groceries + d.budget.transport + d.budget.other + d.budget.buffer)}</strong></div><div><span>Expected monthly income</span><strong>${d.incomes.length ? d.incomes.map(i => `${money(i.amount, i.currency)} ${escape(i.label)}`).join(' · ') : 'None added'}</strong></div><div><span>Semester through</span><strong>${displayDate(p.semesterEnd)}</strong></div></div><label class="approval-check setup-confirm"><input type="checkbox" id="setup-confirm"><span>I reviewed my budget, expected income and ${state.invoice.paid ? 'semester dates' : 'invoice recipient, account, amount and dates'}. Saving this plan does not approve any payment.</span></label>`
  return `${welcome()}<div class="view-title-line"><h1 class="view-heading">Your student plan.</h1><button class="text-button" data-view="overview">Back to Home ↗</button></div><p class="view-description">Three short steps: your life abroad, your monthly money, then a final review. Sample details are filled in—change anything to suit you.</p><div class="setup-workspace"><div class="setup-main"><ol class="setup-progress" aria-label="Setup progress">${['About you', 'Money & income', 'Review & tuition'].map((label, index) => `<li class="${index + 1 === setupStep ? 'current' : index + 1 < setupStep ? 'done' : ''}" ${index + 1 === setupStep ? 'aria-current="step"' : ''}><span>0${index + 1}</span>${label}</li>`).join('')}</ol><form id="student-setup-form" class="student-setup-form">${fields}<p class="error" id="setup-error" role="status"></p><div class="setup-bottom">${setupStep > 1 ? '<button type="button" class="secondary-button" data-setup-action="back">Go back</button>' : '<span class="plan-note">A plan for your session. Simulated funds only.</span>'}<button id="setup-next" type="submit" class="dark-button" ${setupStep === 3 ? 'disabled' : ''}>${setupStep === 3 ? 'Save my plan' : setupStep === 1 ? 'Next: money & income' : 'Next: review details'} ↗</button></div></form></div><aside class="setup-context" aria-label="Your practice account context"><span class="eyebrow">A PLACE TO START</span><h2>Your money,<br>already in view.</h2><p>Build your plan around the balances below. Saving your profile doesn’t move money.</p><div class="setup-account-ledger">${Object.entries(
    state.balances
  )
    .map(
      ([currency, amount]) =>
        `<div><span>${currency}</span><strong>${money(amount, currency)}</strong></div>`
    )
    .join(
      ''
    )}</div><p class="setup-context-note">Expected income helps you explore the future. It becomes spendable only when it arrives.</p></aside></div>${footer()}`
}

function readSetupStep() {
  const d = setupDraft
  if (setupStep === 1) {
    for (const [key, id] of [
      ['name', 'student-name'],
      ['university', 'student-university'],
      ['homeCity', 'student-home'],
      ['studyCity', 'student-study'],
      ['homeCurrency', 'student-currency'],
      ['semesterEnd', 'student-end'],
    ])
      d.profile[key] = $('#' + id).value
  }
  if (setupStep === 2) {
    for (const key of ['rent', 'groceries', 'transport', 'other', 'buffer'])
      d.budget[key] = Number($('#setup-' + key).value)
    d.schedule.rentDay = Number($('#setup-rent-day').value)
    d.incomes = d.incomes.map((i, index) => ({
      ...i,
      label: $('#income-label-' + index).value,
      amount: Number($('#income-amount-' + index).value),
      currency: $('#income-currency-' + index).value,
      payDay: Number($('#income-day-' + index).value),
    }))
  }
  if (setupStep === 3 && !state.invoice.paid) {
    for (const [key, id] of [
      ['recipient', 'setup-recipient'],
      ['account', 'setup-account'],
      ['reference', 'setup-reference'],
      ['currency', 'setup-tuition-currency'],
      ['due', 'setup-due'],
    ])
      d.invoice[key] = $('#' + id).value
    d.invoice.amount = Number($('#setup-tuition').value)
  }
}

async function submitSetup() {
  readSetupStep()
  if (setupStep < 3) {
    setupStep++
    render()
    $('#student-setup-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (studentBusy) return
  studentBusy = true
  $('#setup-next').disabled = true
  try {
    const d = setupDraft,
      input = {
        profile: d.profile,
        budget: d.budget,
        schedule: d.schedule,
        incomes: d.incomes,
        baseRevision: d.baseRevision,
        confirmed: $('#setup-confirm').checked,
        ...(!state.invoice.paid
          ? { invoice: d.invoice, invoiceConfirmed: $('#setup-confirm').checked }
          : {}),
      }
    const result = await api('student', input)
    await sync(result.state)
    tuitionSource = state.profile.homeCurrency
    fundingBackups = null
    scenarioResult = null
    affordabilityResult = null
    setupDraft = null
    setupStep = 1
    agentDrafts.clear()
    agentFamilyPreviews.clear()
    navigate('overview')
    toast('Your semester plan is ready. Older payment quotes need fresh review.')
  } catch (error) {
    $('#setup-error').textContent = error.message
    if (error.code === 'STATE_CHANGED')
      $('#setup-error').insertAdjacentHTML(
        'beforeend',
        ' <button type="button" class="text-button" data-action="student-setup">Reload setup ↻</button>'
      )
  } finally {
    studentBusy = false
    if ($('#setup-next')) $('#setup-next').disabled = !$('#setup-confirm')?.checked
  }
}

document.addEventListener('submit', event => {
  if (event.target.id === 'student-setup-form') {
    event.preventDefault()
    submitSetup()
  }
})

document.addEventListener('change', event => {
  if (event.target.id === 'setup-confirm')
    $('#setup-next').disabled = !event.target.checked || studentBusy
})

document.addEventListener('click', event => {
  const button = event.target.closest('[data-setup-action]')
  if (!button) return
  readSetupStep()
  if (button.dataset.setupAction === 'back') setupStep--
  if (button.dataset.setupAction === 'add-income')
    setupDraft.incomes.push({
      label: 'Family support',
      amount: 0,
      currency: setupDraft.profile.homeCurrency,
      payDay: 1,
    })
  if (button.dataset.setupAction === 'remove-income')
    setupDraft.incomes.splice(Number(button.dataset.incomeIndex), 1)
  render()
})

function agentText(value) {
  return escape(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
}

function guardianSection() {
  const g = state.guardian
  if (state.invoice.paid) return ''
  if (g.status === 'clear')
    return `<details class="guardian-clear"><summary><span><span aria-hidden="true">✓</span> Invoice details match your previous review</span><span>What we checked ↗</span></summary><p>The recipient, account, amount and currency match the last reviewed details. ${escape(g.limitation)}</p></details>`
  return `<section class="guardian-section ${g.canPlan ? 'cleared' : 'paused'}" aria-labelledby="guardian-title"><div class="section-head"><div><span class="eyebrow">TUITION GUARDIAN · ${g.status === 'review-required' ? 'REVIEW NEEDED' : g.status === 'blocked' ? 'PAYMENT BLOCKED' : g.status === 'reviewed' ? 'CHANGES REVIEWED' : 'CONSISTENCY CHECK'}</span><h2 id="guardian-title">${g.canPlan ? (g.status === 'reviewed' ? 'The changes, checked.' : 'Familiar details. A little reassurance.') : 'Something changed. Take a closer look.'}</h2></div><span class="guardian-mark" aria-hidden="true">${g.canPlan ? '✓' : '!'}</span></div>${g.flags.length ? guardianRows(g) : '<p>The recipient, account, amount and currency match your last reviewed invoice.</p>'}${g.review ? `<p class="guardian-review-note">Reviewed through ${escape({ 'university-portal': 'the university portal', 'known-contact': 'a known university contact', 'in-person': 'an in-person visit' }[g.review.method])} · ${escape(g.review.note)}</p>` : ''}<p class="guardian-limit">${escape(g.limitation)}</p>${!g.canPlan && g.status !== 'blocked' ? '<button class="dark-button" data-action="guardian-review">Review these differences ↗</button>' : ''}${g.status === 'blocked' ? '<p class="error">A paid reference cannot be cleared for another payment. Check Activity for the original receipt.</p>' : ''}</section>`
}

function guardianRows(g) {
  return `<div class="guardian-differences">${g.flags.map(f => `<div class="guardian-difference"><strong>${escape(f.label)}</strong><div><span>Previously reviewed</span><p>${escape(f.before ?? 'No previous record')}</p></div><div><span>Current invoice</span><p>${escape(f.after ?? 'Not found')}</p></div></div>`).join('')}</div>`
}

function guardianReview() {
  const g = state.guardian
  guardianReviewInput = structuredClone(g)
  openModal(
    `<h2 id="modal-title">Check the change at its source.</h2><p>Use your university portal, a contact you already know, or an in-person visit. Contact details inside a changed invoice are not independent confirmation.</p>${guardianRows(g)}<form id="guardian-form"><div class="field"><label for="guardian-method">How did you check?</label><select id="guardian-method" required><option value="">Choose a verification method</option><option value="university-portal">University portal I already use</option><option value="known-contact">University contact I already know</option><option value="in-person">In-person university visit</option></select></div><div class="field"><label for="guardian-note">What did you confirm?</label><textarea id="guardian-note" rows="3" minlength="8" maxlength="240" required placeholder="Record how you checked these exact changes. Avoid personal contact information."></textarea></div><label class="approval-check"><input id="guardian-confirm" type="checkbox" required><span>I independently checked every difference shown above. This clears the comparison for planning; it does not approve payment.</span></label><p class="error" id="guardian-error" role="status"></p><button type="submit" class="dark-button" id="guardian-save">Record my change review ↗</button></form>`
  )
}

async function saveGuardianReview() {
  const g = guardianReviewInput
  $('#guardian-save').disabled = true
  try {
    const result = await api('invoice/review-changes', {
      invoiceId: g.invoiceId,
      checkDigest: g.checkDigest,
      baseRevision: g.revision,
      confirmed: $('#guardian-confirm').checked,
      method: $('#guardian-method').value,
      note: $('#guardian-note').value,
    })
    await sync(result.state)
    closeModal()
    render()
    toast('Change review recorded. Payment still requires approval.')
  } catch (error) {
    $('#guardian-error').textContent = error.message
    $('#guardian-save').disabled = false
  }
}

function familySection() {
  return `<section class="family-section"><span class="eyebrow">A LITTLE HELP FROM HOME</span><div class="section-head"><h2>Need a little help from home?</h2><button class="text-button" data-action="family-request">Prepare a family request ↗</button></div><p>Work out the remaining gap and create a private summary to share yourself. You choose what information to include.</p></section>`
}

function familyRequest(preview = null) {
  const sourceCurrency = preview?.sourceCurrency || tuitionSource,
    requestCurrency = preview?.currency || state.profile.homeCurrency,
    backups = preview?.backupCurrencies ?? selectedBackups()
  familyResult = null
  familySequence++
  openModal(
    `<h2 id="modal-title">A clear request. On your terms.</h2><p>Calculate additional tuition funding after your selected accounts contribute. This creates a text download for you to share yourself.</p><form id="family-form"><div class="family-fields"><div class="field"><label for="family-source">My primary contribution account</label><select id="family-source">${currencyOptions(sourceCurrency)}</select></div><div class="field"><label for="family-currency">Ask for support in</label><select id="family-currency">${currencyOptions(requestCurrency)}</select></div></div><fieldset class="family-options"><legend>Other accounts I may contribute from</legend>${['EUR', 'GBP', 'CNY'].map(c => `<label><input type="checkbox" name="family-backup" value="${c}" ${c === sourceCurrency ? 'disabled' : ''} ${backups.includes(c) ? 'checked' : ''}> ${c}${c === 'EUR' ? ' · only above the living reserve' : ''}</label>`).join('')}</fieldset><fieldset class="family-options"><legend>Optional information to include</legend>${[
      ['studentName', 'My name'],
      ['university', 'University / recipient'],
      ['tuitionTotal', 'Full tuition amount'],
      ['studentContribution', 'My contribution'],
    ]
      .map(
        ([key, label]) =>
          `<label><input type="checkbox" name="family-share" value="${key}" ${key === 'university' ? 'checked' : ''}> ${label}</label>`
      )
      .join(
        ''
      )}</fieldset><p class="plan-note">Account numbers, invoice references, balances and income details are excluded. Estimates use simulated rates and fees.</p><p id="family-error" class="error" role="status"></p><button type="submit" class="dark-button" id="family-preview">Preview my request ↗</button></form><div id="family-output" aria-live="polite"></div>`
  )
}

async function previewFamilyRequest() {
  const sequence = ++familySequence
  familyResult = null
  const sourceCurrency = $('#family-source').value,
    input = {
      sourceCurrency,
      backupCurrencies: [...document.querySelectorAll('[name=family-backup]:checked')]
        .map(el => el.value)
        .filter(c => c !== sourceCurrency),
      currency: $('#family-currency').value,
      share: Object.fromEntries(
        [...document.querySelectorAll('[name=family-share]')].map(el => [el.value, el.checked])
      ),
    }
  $('#family-preview').disabled = true
  $('#family-error').textContent = ''
  $('#family-output').innerHTML = ''
  try {
    const { preview } = await api('family/preview', input)
    if (sequence !== familySequence || !$('#family-output')) return
    familyInput = input
    familyResult = preview
    $('#family-output').innerHTML = preview.funded
      ? '<div class="family-funded"><h3>These accounts already cover tuition.</h3><p>No additional family funding is needed for this invoice. Review the payment plan when you are ready.</p></div>'
      : `<div class="family-gap"><span class="eyebrow">ADDITIONAL TUITION FUNDING NEEDED</span><strong>${money(preview.shortfall, preview.tuitionCurrency)}</strong><p>Your selected accounts can contribute ${money(preview.studentContribution, preview.tuitionCurrency)} after conversion fees. Their estimated fees total ${money(preview.studentFeesEUR)}. Your protected euro reserve stays untouched.</p></div><div class="receipt"><div class="receipt-row"><span>Estimated family contribution</span><strong>${money(preview.quote.amount, preview.currency)}</strong></div><div class="receipt-row"><span>Includes illustrative fee</span><strong>${money(preview.quote.fee, preview.currency)}</strong></div><div class="receipt-row"><span>Arrival / tuition deadline</span><strong>${displayDate(preview.quote.arrival)} / ${displayDate(preview.deadline)}</strong></div></div><span class="eyebrow">EXACT DOWNLOAD CONTENT</span><pre class="family-preview-text">${escape(preview.text)}</pre><label class="approval-check"><input type="checkbox" id="family-confirm"><span>I reviewed this estimate and the information included. Creating it sends no message and moves no funds.</span></label><button class="dark-button" data-action="create-family-request" id="create-family-request" disabled>Create private download ↗</button>`
  } catch (error) {
    if (sequence === familySequence && $('#family-error'))
      $('#family-error').textContent = error.message
  } finally {
    if ($('#family-preview')) $('#family-preview').disabled = false
  }
}

async function saveFamilyRequest() {
  if (!familyResult || !$('#family-confirm')?.checked) return
  $('#create-family-request').disabled = true
  try {
    const result = await api('family/request', {
      ...familyInput,
      previewDigest: familyResult.previewDigest,
      confirmed: true,
    })
    await sync(result.state)
    openModal(
      `<h2 id="modal-title">Ready for you to share.</h2><p>Your request is saved as a private snapshot. No message was sent and no funds moved. Recreate the estimate if your invoice, rates or available funds change.</p><pre class="family-preview-text">${escape(result.request.text)}</pre><a class="dark-button family-download" href="/api/family/request/${encodeURIComponent(result.request.id)}" download>Download funding request ↙</a><button class="secondary-button" data-action="close">Done</button>`
    )
  } catch (error) {
    if ($('#family-error')) $('#family-error').textContent = error.message
    if ($('#create-family-request')) $('#create-family-request').disabled = false
  }
}

function paymentPinReady() {
  return (
    !!securityInfo.hasPin &&
    (!securityInfo.lockedUntil || Date.parse(securityInfo.lockedUntil) <= Date.now()) &&
    /^\d{6,12}$/.test($('#payment-pin')?.value || '')
  )
}

function updateApprovalButton() {
  if ($('#approve-button'))
    $('#approve-button').disabled =
      !$('#approval-checkbox')?.checked || (!activeApproval && !paymentPinReady())
}

document.addEventListener('input', event => {
  if (event.target.id === 'payment-pin') updateApprovalButton()
})

function paymentPinFields() {
  return securityInfo.hasPin
    ? `<div class="payment-pin-field field"><label for="payment-pin">Your payment PIN</label><input id="payment-pin" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="12" pattern="[0-9]{6,12}" placeholder="6–12 digits" aria-describedby="payment-pin-help"><small id="payment-pin-help">Required for this exact approval. Your PIN is never sent to the AI.${securityInfo.lockedUntil ? ` Payment attempts locked until ${new Date(securityInfo.lockedUntil).toLocaleTimeString('en-GB')}.` : ''}</small></div>`
    : `<div class="payment-pin-setup"><span class="eyebrow">ONE MORE LAYER OF PROTECTION</span><p>Set a payment PIN before approving tuition or a transfer. The agent can prepare a plan; only you can enter the PIN to approve it.</p><button class="secondary-button" data-action="setup-payment-pin">Set my payment PIN ↗</button></div>`
}

async function securitySettings() {
  try {
    securityInfo = (await api('security/status')).security
    openModal(
      `<h2 id="modal-title">A little more peace of mind.</h2><p>The server checks every sandbox payment before execution.</p><div class="security-ledger"><div><span>Saved financial data</span><strong>Encrypted · AES-256-GCM</strong></div><div><span>Payment approval</span><strong>${securityInfo.hasPin ? 'PIN + exact-plan confirmation' : 'Payment PIN setup required'}</strong></div><div><span>Incorrect PIN attempts</span><strong>${securityInfo.lockedUntil ? 'Locked for five minutes' : `${securityInfo.attemptsRemaining} attempts remaining`}</strong></div><div><span>Audit integrity</span><strong>${state.auditIntegrity ? 'Verified before account operations' : 'Operations blocked'}</strong></div><div><span>Agent authority</span><strong>Read, compare and prepare</strong></div></div><button class="dark-button" data-action="configure-pin">${securityInfo.hasPin ? 'Change my payment PIN' : 'Set my payment PIN'} ↗</button><p class="security-limit">Payments use simulated accounts. A payment PIN is an extra approval check, not bank authentication or a separate second factor. The storage key must be protected separately from saved data.</p>`
    )
  } catch (error) {
    toast(error.message)
  }
}

function configurePaymentPin(returnDraft = null) {
  pinReturnDraft = returnDraft
  pinReturnSettings =
    $('#modal').open && $('#modal-title')?.textContent === 'A little more peace of mind.'
  openModal(
    `<h2 id="modal-title">${securityInfo.hasPin ? 'A new payment PIN.' : 'Your approval. Your PIN.'}</h2><p>Choose 6–12 digits. You’ll enter this PIN every time you approve a payment. Keep it separate from your real banking PIN.</p><form id="payment-pin-form" class="security-pin-form">${securityInfo.hasPin ? '<div class="field"><label for="current-payment-pin">Current payment PIN</label><input id="current-payment-pin" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required></div>' : ''}<div class="field"><label for="new-payment-pin">New payment PIN</label><input id="new-payment-pin" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required></div><div class="field"><label for="repeat-payment-pin">Repeat payment PIN</label><input id="repeat-payment-pin" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required></div><label class="approval-check"><input type="checkbox" id="pin-setup-confirm" required><span>I understand this PIN protects sandbox payment approvals. Saving it does not approve a payment.</span></label><p class="error" id="pin-setup-error" role="status"></p><button type="submit" class="dark-button" id="pin-setup-save">Save my payment PIN ↗</button></form><p class="security-limit">Your PIN is checked by the server and kept out of AI requests, exports and activity records. Changing it cancels pending approvals.</p>`
  )
}

async function savePaymentPin() {
  const button = $('#pin-setup-save')
  button.disabled = true
  const returnDraft = pinReturnDraft
  try {
    const result = await api('security/pin', {
      newPin: $('#new-payment-pin').value,
      repeatPin: $('#repeat-payment-pin').value,
      ...(securityInfo.hasPin ? { currentPin: $('#current-payment-pin').value } : {}),
      confirmed: $('#pin-setup-confirm').checked,
    })
    csrf = result.csrf
    securityInfo = result.security
    await sync(result.state)
    pinReturnDraft = null
    closeModal()
    if (returnDraft) {
      pendingAction = returnDraft
      await refreshQuote()
    } else {
      render()
      if (pinReturnSettings) await securitySettings()
    }
    toast('Payment PIN saved. Pending approvals are revoked; fresh review is required.')
  } catch (error) {
    if ($('#pin-setup-error')) $('#pin-setup-error').textContent = error.message
    for (const input of document.querySelectorAll('#payment-pin-form input[type=password]'))
      input.value = ''
    if ($('#pin-setup-save')) $('#pin-setup-save').disabled = false
  }
}

function openAssistant() {
  if ($('#modal').open) return
  if (!$('#assistant-dialog').open) $('#assistant-dialog').showModal()
}

function closeAssistant() {
  if ($('#assistant-dialog').open) $('#assistant-dialog').close()
}

$('#assistant-dialog').addEventListener('click', event => {
  if (event.target === $('#assistant-dialog')) closeAssistant()
})

function reviewSavedInvoice() {
  extractedInvoice = { fields: { ...state.invoice }, source: 'saved', evidence: {}, warnings: [] }
  invoiceVerify()
}

function tuitionSteps() {
  const paid = state.invoice.paid,
    checked = state.invoice.verified && state.guardian.canPlan
  return `<ol class="payment-steps" aria-label="Tuition payment steps"><li class="${checked ? 'done' : 'current'}"><span>${checked ? '✓' : '01'}</span><div><strong>Check invoice</strong><small>Recipient, amount, deadline</small></div></li><li class="${paid ? 'done' : checked ? 'current' : ''}"><span>${paid ? '✓' : '02'}</span><div><strong>Choose funding</strong><small>Accounts, fees, arrival</small></div></li><li class="${paid ? 'done' : ''}"><span>${paid ? '✓' : '03'}</span><div><strong>Review & approve</strong><small>Your confirmation and PIN</small></div></li></ol>`
}
