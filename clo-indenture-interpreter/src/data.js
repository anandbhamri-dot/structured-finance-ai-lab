/* Example CLO I — a fictional CLO 1.0 deal used as the built-in example.
   Its structure follows a typical 2007-vintage US cash-flow CLO; the names, balances, spreads, triggers,
   fees and limits are made up. Section references point to the fictional indenture in
   sample_inputs/example-clo-indenture.txt, which the reader can read like a real document. */
(function (root) {
'use strict';
const SEQ = ['A', 'B', 'C', 'D', 'E'];

const EXAMPLE_CLO = {
  version: 1,
  meta: {
    name: 'Example CLO I, Ltd.', manager: 'Example Credit Partners LLC', trustee: 'Example Trust Company, N.A.',
    document: 'example indenture (fictional, in sample_inputs)',
    closingDate: '2007-08-14', firstPaymentDate: '2008-01-18', paymentFrequencyMonths: 3, paymentDay: 18,
    statedMaturity: '2021-07-18', reinvestmentPeriodEnd: '2014-07-18', nonCallEnd: '2011-07-18',
    effectiveDate: '2007-12-27', effectiveDateNote: 'Assumed 135 days after closing; the Indenture fixes it as the earlier of that date and reaching Target Par.',
    targetPar: 400000000, dayCount: 'Actual/360', index: '3-month LIBOR',
    refs: { notes: '§2.3', paymentDates: '§1.1, p. 4', reinvestment: '§1.1, p. 5', nonCall: '§9.2, p. 8', targetPar: '§1.1, p. 5' }
  },
  classes: [
    { id: 'A', name: 'Class A Senior Notes', balance: 304000000, spread: 0.27, deferrable: false, rating: 'Aaa / AAA', spCol: 'AAA', ref: '§2.3, p. 6' },
    { id: 'B', name: 'Class B Senior Notes', balance: 30000000, spread: 0.65, deferrable: false, rating: 'Aa2 / AA', spCol: 'AA', ref: '§2.3, p. 6' },
    { id: 'C', name: 'Class C Deferrable Mezzanine Notes', balance: 25000000, spread: 1.35, deferrable: true, rating: 'A2 / A', spCol: 'A', ref: '§2.3, p. 6' },
    { id: 'D', name: 'Class D Deferrable Mezzanine Notes', balance: 13000000, spread: 3.10, deferrable: true, rating: 'Baa2 / BBB', spCol: 'BBB', ref: '§2.3, p. 6' },
    { id: 'E', name: 'Class E Deferrable Junior Notes', balance: 12500000, spread: 5.25, deferrable: true, rating: 'Ba2 / BB', spCol: 'BB', ref: '§2.3, p. 6' }
  ],
  equity: { id: 'SUB', name: 'Subordinated Notes', balance: 30500000, ref: '§2.3, p. 6' },
  labels: { taxes: 'Taxes and governmental fees', admin: 'Administrative Expenses (capped)', adminExcess: 'Administrative Expenses above cap', hedge: 'Hedge Payment Amount', hedgeTermSenior: 'Senior hedge termination', hedgeTermSub: 'Subordinated hedge termination', seniorMgmt: 'Senior Collateral Management Fee', structuring: 'Senior Deferred Structuring Fee', revolverFunding: 'Unfunded revolver / synthetic obligations' },
  fees: {
    seniorMgmt: { label: 'Senior Collateral Management Fee', schedule: [{ through: '2011-07-18', bps: 7.5 }, { bps: 15 }], basis: 'Fee Basis Amount, Actual/360', ref: '§1.1, p. 5' },
    structuring: { label: 'Senior Deferred Structuring Fee', schedule: [{ through: '2011-07-18', bps: 8 }, { bps: 0 }], ref: '§1.1, p. 5' },
    subMgmt: { label: 'Subordinated Collateral Management Fee', bps: 30, unpaidAccruesAtClass: 'E', ref: '§1.1, p. 5' },
    adminCap: { bpsOfPCV: 5, fixed: 150000, priorPeriods: 3, ref: '§11.1(a)(i)(B), p. 9' },
    incentive: { hurdleIRR: 11, managerShare: 20, dayBasis: 360, ref: '§1.1, p. 4' }
  },
  coverage: {
    ocExcludesDeferredInterest: true,
    icNumeratorDeducts: ['A', 'B', 'C', 'D'],
    tests: [
      { id: 'AB', label: 'Class A/B', oc: { classes: ['A', 'B'], trigger: 112.00, ref: '§1.1, p. 2' }, ic: { classes: ['A', 'B'], trigger: 118.00, fromPeriod: 2, ref: '§1.1, p. 2' } },
      { id: 'C', label: 'Class C', oc: { classes: ['A', 'B', 'C'], trigger: 107.00, ref: '§1.1, p. 2' }, ic: { classes: ['A', 'B', 'C'], trigger: 113.00, fromPeriod: 2, ref: '§1.1, p. 2' } },
      { id: 'D', label: 'Class D', oc: { classes: ['A', 'B', 'C', 'D'], trigger: 104.50, ref: '§1.1, p. 3' }, ic: { classes: ['A', 'B', 'C', 'D'], trigger: 108.00, fromPeriod: 2, ref: '§1.1, p. 3' } },
      { id: 'E', label: 'Class E', oc: { classes: ['A', 'B', 'C', 'D', 'E'], trigger: 102.00, ref: '§1.1, p. 3' }, ic: { classes: ['A', 'B', 'C', 'D', 'E'], trigger: 104.00, fromPeriod: 2, ref: '§1.1, p. 3' } }
    ],
    reinvestmentTest: { label: 'Interest Reinvestment Test', ocClasses: SEQ, trigger: 102.80, maxDiversionPct: 50, ref: '§1.1, p. 4' },
    eodTest: { label: 'Class A OC (Event of Default)', ocClasses: ['A'], trigger: 101.00, ref: '§5.1(e), p. 7' }
  },
  haircuts: {
    ccc: { limitPct: 8, haircutPct: 70, moodysAtOrBelow: 'Caa1', spAtOrBelow: 'CCC+', ref: '§1.1, p. 2' },
    defaulted: { zeroAfterYears: 3, ref: '§1.1, p. 5' },
    discount: { loan: { atLeastB3: 80, belowB3: 85 }, other: { atLeastB3: 75, belowB3: 80 }, ref: '§1.1, p. 3' }
  },
  ratingFactors: { Aaa: 1, Aa1: 10, Aa2: 20, Aa3: 40, A1: 70, A2: 120, A3: 180, Baa1: 260, Baa2: 360, Baa3: 610, Ba1: 940, Ba2: 1350, Ba3: 1766, B1: 2220, B2: 2720, B3: 3490, Caa1: 4770, Caa2: 6500, Caa3: 8070, Ca: 10000, C: 10000, NR: 10000 },
  recovery: {
    moodys: {
      SSL: { '-3': 20, '-2': 30, '-1': 40, '0': 45, '1': 50, '2': 60 },
      NSSL: { '-3': 10, '-2': 15, '-1': 30, '0': 40, '1': 42.5, '2': 45 },
      BOND: { '-3': 2, '-2': 10, '-1': 15, '0': 30, '1': 35, '2': 40 },
      ref: 'Schedule 2, p. 16'
    },
    sp: {
      cols: ['AAA', 'AA', 'A', 'BBB', 'BB'],
      table: { '1+': [100, 100, 100, 100, 100], '1': [92, 94, 96, 98, 100], '2': [78, 81, 84, 87, 90], '3': [58, 61, 64, 67, 70], '4': [38, 41, 44, 47, 50], '5': [16, 20, 24, 27, 30], '6': [6, 7, 8, 9, 10] },
      defaultRecoveryRating: { SSL: '3', '2L': '5', UNSEC: '5', BOND: '5' },
      ref: 'Schedule 2, p. 16'
    }
  },
  spreadRules: { minWAS: 2.10, minWAC: 8.0, excessParSpread: true, ref: '§1.1, p. 4' },
  selections: {
    moodysModifier: { label: 'Moody\'s Modifier Variable', options: [45, 48, 52, 56, 60], default: 45, ref: 'Schedule 1, p. 16' },
    spCase: { label: 'S&P case (spread and recovery)', options: [1, 2, 3, 4, 5, 6, 7], default: 4, ref: 'Schedule 1, p. 16' }
  },
  qualityTests: [
    { id: 'warf', label: 'Moody\'s Maximum WARF', metric: 'warf', op: '<=', ref: 'Schedule 1, p. 16',
      limit: { type: 'matrix', cap: 3000, modifier: { base: 44.5, mult: 50 },
        main: { rows: [2.00, 2.25, 2.50, 2.75, 3.00, 3.25, 3.50], cols: [50, 55, 60, 65, 70, 75, 80, 85, 90], values: [
          [2050, 2100, 2150, 2165, 2180, 2185, 2210, 2220, 2230], [2240, 2295, 2330, 2375, 2390, 2410, 2430, 2465, 2480], [2395, 2450, 2505, 2525, 2550, 2565, 2575, 2620, 2665],
          [2575, 2625, 2665, 2690, 2705, 2710, 2735, 2755, 2765], [2660, 2710, 2790, 2835, 2870, 2880, 2925, 2940, 2970], [2770, 2830, 2865, 2920, 2930, 2980, 3000, 3000, 3000],
          [2850, 2915, 2970, 3000, 3000, 3000, 3000, 3000, 3000]] },
        alt: { rows: [2.00, 2.25, 2.50, 2.75, 3.00, 3.25, 3.50], cols: [50, 55, 60, 65, 70, 75, 80, 85, 90], values: [
          [2000, 2050, 2100, 2115, 2130, 2135, 2160, 2170, 2180], [2190, 2245, 2280, 2325, 2340, 2360, 2380, 2415, 2430], [2345, 2400, 2455, 2475, 2500, 2515, 2525, 2570, 2615],
          [2525, 2575, 2615, 2640, 2655, 2660, 2685, 2705, 2715], [2610, 2660, 2740, 2785, 2820, 2830, 2875, 2890, 2920], [2720, 2780, 2815, 2870, 2880, 2930, 2965, 3000, 3000],
          [2800, 2865, 2920, 2965, 2980, 3000, 3000, 3000, 3000]] } } },
    { id: 'mwas', label: 'Moody\'s Weighted Average Spread', metric: 'was', op: '>=', limit: 2.10, adjust: { type: 'recoveryModifier', table: [[45, 5], [48, 6], [52, 8], [56, 10], [60, null]] }, ref: 'Schedule 1, p. 16' },
    { id: 'swas', label: 'S&P Minimum Average Spread', metric: 'was', op: '>=', limit: { type: 'case', values: [2.05, 2.30, 2.40, 2.60, 2.80, 3.05, 3.30] }, ref: 'Schedule 1, p. 16' },
    { id: 'wac', label: 'Weighted Average Coupon', metric: 'wac', op: '>=', limit: 8.0, ref: '§1.1, p. 4' },
    { id: 'wal', label: 'Weighted Average Life', metric: 'wal', op: '<=', limit: { type: 'declining', startYears: 9.5, from: 'effectiveDate' }, ref: '§1.1, p. 5' },
    { id: 'div', label: 'Moody\'s Diversity Score', metric: 'diversity', op: '>=', limit: 48, ref: '§1.1, p. 4' },
    { id: 'mwarr', label: 'Moody\'s Minimum Weighted Average Recovery Rate', metric: 'moodysWARR', op: '>=', limit: 44.0, ref: 'Schedule 2, p. 16' },
    { id: 'swarr', label: 'S&P Minimum Weighted Average Recovery Rate', metric: 'spWARR', op: '>=', ref: 'Schedule 2, p. 16',
      limit: { type: 'caseByClass', values: [[65.20, 68.20, 71.20, 74.20, 77.20], [62.00, 65.00, 68.00, 71.00, 74.00], [60.65, 63.65, 66.65, 69.65, 72.65], [58.00, 61.00, 64.00, 67.00, 70.00], [55.45, 58.45, 61.45, 64.45, 67.45], [53.00, 56.00, 59.00, 62.00, 65.00], [51.50, 54.50, 57.50, 60.50, 63.50]] } },
    { id: 'cdom', label: 'S&P CDO Monitor', metric: 'external', ref: '§1.1, p. 5', note: 'Needs S&P\'s CDO Monitor model output; enter pass or fail manually.' }
  ],
  concentrations: [
    { id: '(i)', label: 'Pays interest less often than quarterly', filter: [{ f: 'payFreq', in: ['S', 'A'] }], limit: 10, ref: '§12.2, p. 14' },
    { id: '(i)a', label: 'Pays interest less often than semi-annually', filter: [{ f: 'payFreq', in: ['A'] }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(ii)', label: 'Revolvers and delayed drawdowns', filter: [{ f: 'revolver', eq: true }], limit: 10, ref: '§12.2, p. 14' },
    { id: '(iv)', label: 'Fixed rate', filter: [{ f: 'rateType', in: ['FIXED'] }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(v)', label: 'Senior secured and second lien loans', filter: [{ f: 'assetType', in: ['SSL', '2L'] }], op: '>=', limit: 95, cashAs: { assetType: 'SSL', country: 'US' }, ref: '§12.2, p. 14' },
    { id: '(v)a', label: 'Second lien, unsecured loans and bonds', filter: [{ f: 'assetType', in: ['2L', 'UNSEC', 'BOND'] }], limit: 10, ref: '§12.2, p. 14' },
    { id: '(vii)', label: 'Participation interests', filter: [{ f: 'participation', eq: true }], limit: 15, ref: '§12.2, p. 14' },
    { id: '(viii)', label: 'Single obligor', metric: 'maxObligor', limit: 2, exceptions: { count: 4, limit: 2.5 }, ref: '§12.2, p. 14' },
    { id: '(ix)', label: 'Single S&P industry', metric: 'maxIndustry', field: 'spIndustry', limit: 10, exceptions: { count: 2, limit: 12 }, ref: '§12.2, p. 14' },
    { id: '(x)A', label: 'First-lien senior secured, US, Canada or UK obligors', filter: [{ f: 'assetType', in: ['SSL'] }, { f: 'country', in: ['US', 'CA', 'GB', 'UK'] }], op: '>=', limit: 85, cashAs: { assetType: 'SSL', country: 'US' }, ref: '§12.2, p. 14' },
    { id: '(x)B1', label: 'Non-US obligors', filter: [{ f: 'country', notIn: ['US'] }], limit: 20, ref: '§12.2, p. 14' },
    { id: '(x)B2', label: 'Non-US, non-Canadian obligors', filter: [{ f: 'country', notIn: ['US', 'CA'] }], limit: 10, ref: '§12.2, p. 14' },
    { id: '(x)B3', label: 'Canadian obligors', filter: [{ f: 'country', in: ['CA'] }], limit: 15, ref: '§12.2, p. 14' },
    { id: '(x)B4', label: 'Any single Group I country (UK, Australia, Netherlands)', metric: 'maxByField', field: 'country', within: ['GB', 'UK', 'AU', 'NL'], limit: 10, ref: '§12.2, p. 14' },
    { id: '(x)B5', label: 'Any single Group II country (Germany, Ireland, Sweden, Switzerland)', metric: 'maxByField', field: 'country', within: ['DE', 'IE', 'SE', 'CH'], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xi)', label: 'Caa1 / CCC+ and below', filter: [{ f: 'ccc', eq: true }], limit: 8, ref: '§12.2, p. 14' },
    { id: '(xii)', label: 'DIP loans', filter: [{ f: 'dip', eq: true }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xiii)', label: 'Current pay obligations', filter: [{ f: 'currentPay', eq: true }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xiv)', label: 'PIK and partial PIK', filter: [{ f: 'pik', eq: true }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xvii)', label: 'Facility size under $100m', filter: [{ f: 'facilitySize', lt: 100000000 }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xviii)', label: 'Zero coupon', filter: [{ f: 'zeroCoupon', eq: true }], limit: 2, ref: '§12.2, p. 14' },
    { id: '(xix)', label: 'Senior unsecured loans', filter: [{ f: 'assetType', in: ['UNSEC'] }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xx)', label: 'Bonds', filter: [{ f: 'assetType', in: ['BOND'] }], limit: 5, ref: '§12.2, p. 14' },
    { id: '(xxii)', label: 'Cov-lite loans', filter: [{ f: 'covLite', eq: true }], limit: 25, ref: '§12.2, p. 14' },
    { id: '(xxiii)', label: 'Synthetic securities', filter: [{ f: 'synthetic', eq: true }], limit: 20, ref: '§12.2, p. 14' },
    { id: 'Elig. (xx)', label: 'Maturing after Stated Maturity', filter: [{ f: 'matAfterStated', eq: true }], limit: 2, ref: '§12.1, p. 14' }
  ],
  waterfalls: {
    interest: [
      { id: 'A', type: 'expense', item: 'taxes', label: 'Taxes', clause: 'Taxes and governmental fees owed by the Issuer.' },
      { id: 'B', type: 'expense', item: 'admin', label: 'Administrative Expenses, capped', clause: 'Trustee, administrator, rating agency and other expenses in the set payment sequence, limited across this and the three prior Payment Dates to 0.05% of Principal Collateral Value plus $150,000.' },
      { id: 'C', type: 'expense', item: 'hedge', label: 'Hedge Payment Amount', clause: 'Scheduled net amounts owed to hedge counterparties.' },
      { id: 'D', type: 'fees', items: ['seniorMgmt', 'structuring'], label: 'Senior management and structuring fees', clause: 'Senior Collateral Management Fee and Senior Deferred Structuring Fee, pari passu.' },
      { id: 'E', type: 'interest', classes: ['A'], withSeniorTermination: true, label: 'Class A interest', clause: 'Class A interest, pari passu with senior hedge and synthetic termination payments.' },
      { id: 'F', type: 'interest', classes: ['B'], label: 'Class B interest', clause: 'Class B interest.' },
      { id: 'G', type: 'cure', test: 'AB', paydown: ['A', 'B'], label: 'Class A/B coverage cure', clause: 'If either Class A/B test fails, pay down A then B until it passes. The IC test is not applied on the first Payment Date.' },
      { id: 'H', type: 'interest', classes: ['C'], includeDeferred: true, label: 'Class C interest, then deferred', clause: 'Class C current interest, then any Class C deferred interest and interest on it.' },
      { id: 'I', type: 'cure', test: 'C', paydown: ['A', 'B', 'C'], includeDeferredOf: ['C'], label: 'Class C coverage cure', clause: 'If either Class C test fails, pay down A, B, then C (including its deferred interest) until it passes.' },
      { id: 'J', type: 'interest', classes: ['D'], includeDeferred: true, label: 'Class D interest, then deferred', clause: 'Class D current interest, then any Class D deferred interest.' },
      { id: 'K', type: 'cure', test: 'D', paydown: ['A', 'B', 'C', 'D'], label: 'Class D coverage cure', clause: 'If either Class D test fails, pay down A, B, C, then D until it passes.' },
      { id: 'L', type: 'interest', classes: ['E'], includeDeferred: true, label: 'Class E interest, then deferred', clause: 'Class E current interest, then any Class E deferred interest.' },
      { id: 'M', type: 'cure', test: 'E', paydown: ['E'], label: 'Class E coverage cure', clause: 'If either Class E test fails, pay down Class E only, from Interest Proceeds, until it passes.' },
      { id: 'N', type: 'rcf', when: 'rcf', paydown: SEQ, label: 'Rating Confirmation Failure', clause: 'While a Rating Confirmation Failure continues, pay down A through E sequentially until ratings are reinstated.' },
      { id: 'O', type: 'subMgmtFee', label: 'Subordinated management fee', clause: 'Subordinated Collateral Management Fee less any amount the manager elects to defer; the deferred amount stays in the waterfall (or moves to principal), then any cumulative deferred fee the manager elects to take.' },
      { id: 'P', type: 'reinvestmentDiversion', label: 'Interest Reinvestment Test', clause: 'If the Class E OC ratio is below 102.80%, move the lesser of 50% of remaining interest and the cure amount to principal to buy collateral.' },
      { id: 'Q', type: 'expense', items: ['adminExcess', 'hedgeTermSub'], label: 'Uncapped expenses', clause: 'Administrative Expenses above the cap, then subordinated hedge and synthetic termination payments.' },
      { id: 'R', type: 'equityHurdle', label: 'Subordinated Notes to 11% IRR', clause: 'To the Subordinated Notes until their IRR since closing reaches 11% (Actual/360).' },
      { id: 'S', type: 'incentiveSplit', label: 'Residual split 80 / 20', clause: 'Once the hurdle is met, 80% to the Subordinated Notes and 20% to the manager as Incentive Management Fee.' }
    ],
    principal: [
      { id: 'A', type: 'unpaidFrom', steps: ['A', 'B', 'C', 'D', 'E', 'F'], label: 'Senior shortfalls from interest', clause: 'Amounts in interest steps A to F that Interest Proceeds did not cover, in the same order and subject to the same cap.' },
      { id: 'B', type: 'cureAll', tests: ['AB', 'C', 'D', 'E'], paydown: SEQ, includeDeferredOf: ['C', 'D', 'E'], label: 'Coverage cure from principal', clause: 'If any coverage test still fails after the interest waterfall, pay down A through E sequentially (with deferred interest) until it passes.' },
      { id: 'C', type: 'specialRedemption', when: 'specialRedemption', paydown: SEQ, includeDeferredOf: ['C', 'D', 'E'], label: 'Special Redemption', clause: 'Special Redemption Amount sequentially to A through E.' },
      { id: 'D', type: 'rcf', when: 'rcf', paydown: SEQ, includeDeferredOf: ['C', 'D', 'E'], label: 'Rating Confirmation Failure', clause: 'Sequential paydown while a Rating Confirmation Failure continues.' },
      { id: 'E', type: 'reinvest', when: 'duringRP', label: 'Reinvest', clause: 'During the Reinvestment Period, to the Collection Account to buy Collateral Debt Securities.' },
      { id: 'F', type: 'amortize', when: 'afterRP', paydown: SEQ, includeDeferredOf: ['C', 'D', 'E'], label: 'Sequential paydown', clause: 'After the Reinvestment Period: reinvest credit-improved, prepaid and IRT-diverted proceeds at the manager\'s option; pay everything else sequentially to A through E.' },
      { id: 'G', type: 'subMgmtFee', label: 'Unpaid subordinated fee', clause: 'Subordinated management fee not covered by Interest Proceeds.' },
      { id: 'H', type: 'expense', items: ['adminExcess', 'hedgeTermSub'], label: 'Uncapped expenses', clause: 'Administrative Expenses above the cap, then subordinated termination payments.' },
      { id: 'I', type: 'equityHurdle', when: 'noRatedOutstanding', label: 'Subordinated Notes to 11% IRR', clause: 'Only once no rated notes are outstanding (or at Stated Maturity).' },
      { id: 'J', type: 'incentiveSplit', when: 'noRatedOutstanding', label: 'Residual split 80 / 20', clause: '80% to the Subordinated Notes, 20% Incentive Management Fee.' }
    ],
    liquidation: [
      { id: 'A', type: 'expense', item: 'revolverFunding', label: 'Unfunded commitments', clause: 'Obligations under revolvers, delayed drawdowns and unfunded synthetics.' },
      { id: 'B', type: 'expense', items: ['taxes', 'admin'], label: 'Taxes and capped expenses', clause: 'Interest steps A and B, subject to the same cap.' },
      { id: 'C', type: 'expense', item: 'hedgeTermSenior', label: 'Senior hedge termination', clause: 'Hedge termination payments other than subordinated ones.' },
      { id: 'D', type: 'fees', items: ['seniorMgmt', 'structuring'], label: 'Senior fees', clause: 'Senior management fee and structuring fee (with make-whole), pari passu.' },
      { id: 'E', type: 'interestAndPrincipal', class: 'A', label: 'Class A interest and principal', clause: 'Class A interest, then principal to zero.' },
      { id: 'F', type: 'interestAndPrincipal', class: 'B', label: 'Class B interest and principal', clause: 'Class B interest, then principal to zero.' },
      { id: 'G', type: 'interestAndPrincipal', class: 'C', label: 'Class C interest, deferred and principal', clause: 'Class C interest and deferred interest, then principal.' },
      { id: 'H', type: 'interestAndPrincipal', class: 'D', label: 'Class D interest, deferred and principal', clause: 'Class D interest and deferred interest, then principal.' },
      { id: 'I', type: 'interestAndPrincipal', class: 'E', label: 'Class E interest, deferred and principal', clause: 'Class E interest and deferred interest, then principal.' },
      { id: 'J', type: 'subMgmtFee', includeCumulativeDeferred: true, label: 'Subordinated fee and cumulative deferred fee', clause: 'Unpaid subordinated management fee and any Cumulative Deferred Management Fee.' },
      { id: 'K', type: 'expense', items: ['adminExcess', 'hedgeTermSub'], label: 'Uncapped expenses', clause: 'Administrative Expenses above the cap, then subordinated termination payments.' },
      { id: 'L', type: 'equityHurdle', label: 'Subordinated Notes to 11% IRR', clause: 'To the Subordinated Notes until the 11% IRR hurdle is met.' },
      { id: 'M', type: 'incentiveSplit', label: 'Residual split 80 / 20', clause: '80% Subordinated Notes, 20% Incentive Management Fee.' }
    ]
  },
  assumptions: [
    'Payment Dates fall on the 18th without business-day adjustment; interest accrues Actual/360 between Payment Dates and fees use the same day count.',
    'Coverage cures solve for the smallest sequential paydown that passes both the OC and IC test of that class, on a pro forma basis (IC interest re-computed on the paid-down balances) (§11.1(c)).',
    'Principal Proceeds on deposit count in Principal Collection Value, so a cure paid from principal reduces both the numerator and the denominator.',
    'When a cure pays a deferrable class, deferred interest is paid before principal.',
    'CCC Excess is taken from whichever rating bucket (Moody\'s or S&P) is larger, lowest-priced assets first; Discount Obligations and Defaulted Securities are outside the bucket (§1.1 "CCC Excess").',
    'Moody\'s recovery uses the notch gap between the facility rating and the Default Probability Rating; S&P recovery uses Table 1 (asset-specific recovery ratings), defaulting to rating 3 for first lien and 5 otherwise when the tape has none.',
    'Diversity Score uses Moody\'s standard obligor-equivalent and industry-score method; the fictional indenture does not set out its own schedule.',
    'Weighted Average Life treats each asset as a bullet at its maturity date.',
    'The S&P CDO Monitor Test needs S&P\'s model and is entered manually.',
    'Revolvers, delayed drawdowns and synthetics are not modelled beyond the concentration flags.'
  ]
};

// ---------- illustrative loan tape (seeded; NOT the deal's actual holdings)
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const INDUSTRIES = ['Healthcare, Education & Childcare', 'Broadcasting & Entertainment', 'Printing & Publishing', 'Chemicals, Plastics & Rubber', 'Telecommunications', 'Diversified/Conglomerate Service', 'Retail Stores', 'Hotels, Motels, Inns & Gaming', 'Beverage, Food & Tobacco', 'Electronics', 'Containers, Packaging & Glass', 'Automobile', 'Buildings & Real Estate', 'Personal & Non-Durable Consumer Products', 'Aerospace & Defense', 'Leisure, Amusement & Entertainment', 'Oil & Gas', 'Utilities', 'Cargo Transport', 'Machinery', 'Insurance', 'Personal, Food & Misc. Services', 'Diversified/Conglomerate Manufacturing', 'Finance', 'Ecological', 'Grocery', 'Home & Office Furnishings', 'Textiles & Leather'];
const IND_W = [8, 6, 5, 5, 6, 6, 4, 4, 5, 4, 4, 3, 3, 3, 3, 3, 3, 2, 2, 3, 2, 3, 3, 2, 2, 2, 1, 1];
const P1 = ['Arden', 'Bellwether', 'Calloway', 'Dunmore', 'Easton', 'Fairhaven', 'Glenrock', 'Harrow', 'Ironwood', 'Juniper', 'Kestrel', 'Linden', 'Marlow', 'Northgate', 'Oakmont', 'Pinecrest', 'Quarry', 'Redfield', 'Stonebridge', 'Tidewater', 'Upland', 'Vantage', 'Westbrook', 'Yardley', 'Ashford', 'Brookline', 'Cedarline', 'Driftwood', 'Elmstead', 'Foxhall', 'Granite', 'Hollis', 'Inglewood', 'Kingsley', 'Lakeshore', 'Millbrook', 'Norwood', 'Overton', 'Prescott', 'Ridgeway', 'Sutton', 'Thornbury', 'Valemont', 'Whitcombe', 'Alder', 'Blakely', 'Chatham', 'Delmar', 'Everly', 'Fenwick', 'Galloway', 'Hartwell', 'Ivanhoe', 'Jasper', 'Keswick', 'Larchmont', 'Merrill', 'Newbury', 'Orchard', 'Palisade', 'Ramsey', 'Sheffield', 'Talbot', 'Vesper', 'Wexford'];
const P2 = { 'Healthcare, Education & Childcare': ['Health Systems', 'Medical Group', 'Learning'], 'Broadcasting & Entertainment': ['Broadcasting', 'Media Holdings'], 'Printing & Publishing': ['Publishing', 'Directories'], 'Chemicals, Plastics & Rubber': ['Chemical', 'Polymers'], Telecommunications: ['Telecom', 'Fiber Networks'], 'Diversified/Conglomerate Service': ['Services', 'Outsourcing'], 'Retail Stores': ['Stores', 'Retail Group'], 'Hotels, Motels, Inns & Gaming': ['Gaming', 'Resorts'], 'Beverage, Food & Tobacco': ['Foods', 'Beverage'], Electronics: ['Electronics', 'Semiconductor'], 'Containers, Packaging & Glass': ['Packaging', 'Containers'], Automobile: ['Auto Parts', 'Automotive'], 'Buildings & Real Estate': ['Building Products', 'Homes'] };
function pickW(r, items, w) { const t = w.reduce((a, b) => a + b, 0); let x = r() * t; for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; } return items[items.length - 1]; }
const MS = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'];
const SS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C'];
const m2s = m => SS[Math.min(SS.length - 1, MS.indexOf(m))];
const notchM = (m, n) => MS[Math.max(0, Math.min(MS.length - 1, MS.indexOf(m) + n))];

function makeTape(opts) {
  const r = rng(opts.seed || 7); const rows = []; const target = opts.par; let tot = 0; let i = 0;
  const vintage = opts.vintage || 2007;
  while (tot < target - 1) {
    const ind = pickW(r, INDUSTRIES, IND_W);
    const sfx = (P2[ind] || ['Holdings', 'Group', 'Industries'])[Math.floor(r() * (P2[ind] || [1, 2, 3]).length)];
    const name = P1[i % P1.length] + ' ' + sfx + (i >= P1.length ? ' II' : '');
    let par = Math.round(target * (opts.sizeMin || 0.0042) * (1 + r() * (opts.sizeRange || 1.25)) / 250000) * 250000; if (tot + par > target) par = Math.round(target - tot);
    if (par < 250000) { if (rows.length) rows[rows.length - 1].par += par; tot += par; break; }
    const dpr = pickW(r, ['Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1'], opts.ratingW || [3, 18, 32, 30, 14, 3]);
    let assetType = 'SSL'; const u = r();
    if (u < 0.04) assetType = '2L'; else if (u < 0.05) assetType = 'BOND';
    const fac = assetType === 'SSL' ? (r() < 0.62 ? notchM(dpr, -1) : r() < 0.85 ? dpr : notchM(dpr, -2)) : notchM(dpr, assetType === '2L' ? 2 : 1);
    const spread = assetType === '2L' ? 3.75 + r() * 1.25 : assetType === 'BOND' ? 0 : Math.round(((opts.spreadBase || 1.85) + r() * (opts.spreadRange || 1.05) + (MS.indexOf(dpr) - 13) * 0.18) * 400) / 400;
    const country = pickW(r, ['US', 'CA', 'GB', 'NL', 'DE'], [89, 5.5, 3.5, 1.5, 0.5]);
    const matY = vintage + (opts.matStart || 5) + Math.floor(r() * (opts.matSpread || 3)); const matM = 1 + Math.floor(r() * (opts.matMonths || 12));
    const spRec = assetType === 'SSL' ? pickW(r, ['2', '3', '4'], [45, 45, 10]) : '5';
    const px = opts.price ? opts.price(r, dpr) : 99 + r() * 1.5;
    rows.push({
      id: 'L' + String(i + 1).padStart(3, '0'), obligor: name, mIndustry: ind, spIndustry: ind, country, assetType,
      rateType: assetType === 'BOND' ? 'FIXED' : 'FLOAT', par, price: Math.round(px * 100) / 100, purchasePrice: Math.round((opts.purchase ? opts.purchase(r) : 99.5 + r() * 0.5) * 100) / 100,
      spread: assetType === 'BOND' ? 0 : Math.round(spread * 1000) / 1000, coupon: assetType === 'BOND' ? 8.75 + Math.round(r() * 4) / 4 : 0,
      moodysDPR: dpr, moodysFacility: fac, spRating: m2s(dpr), spRecRating: spRec,
      maturity: matY + '-' + String(matM).padStart(2, '0') + '-15', defaulted: 'N', defaultDate: '',
      covLite: r() < (opts.covLite || 0.12) ? 'Y' : 'N', facilitySize: Math.round((150 + r() * 1400) / 25) * 25 * 1e6, payFreq: assetType === 'BOND' ? 'S' : 'Q'
    });
    tot += par; i++;
  }
  return rows;
}

function stressTape(base, opt) {
  // deterministic credit migration for the 2009 scenario
  const r = rng(opt.seed || 11);
  return base.map((x, k) => {
    const y = Object.assign({}, x);
    const u = r();
    if (u < opt.downgradeShare) { const n = 1 + Math.floor(r() * 3); y.moodysDPR = notchM(x.moodysDPR, n); y.moodysFacility = notchM(x.moodysFacility, n); y.spRating = m2s(y.moodysDPR); }
    const idx = MS.indexOf(y.moodysDPR);
    y.price = Math.round(Math.max(30, (idx >= 16 ? 52 + r() * 18 : idx >= 15 ? 66 + r() * 12 : 74 + r() * 12)) * 100) / 100;
    return y;
  });
}

function applyDefaults(rows, list) {
  // list: [{share of par to default, price, date}] picks the weakest names first, deterministic
  const sorted = rows.map((x, i) => ({ x, i })).sort((a, b) => (MS.indexOf(b.x.moodysDPR) - MS.indexOf(a.x.moodysDPR)) || (a.x.price - b.x.price));
  const total = rows.reduce((s, x) => s + x.par, 0);
  for (const d of list) {
    let need = d.share * total;
    for (const s of sorted) { if (need <= 0) break; if (s.x.defaulted === 'Y') continue; s.x.defaulted = 'Y'; s.x.defaultDate = d.date; s.x.price = d.price; s.x.moodysDPR = 'Ca'; s.x.spRating = 'D'; need -= s.x.par; }
  }
  return rows;
}

function applyStress(tape, s, asOf) {
  if (!s || (!s.extraDefaultPct && !s.notches && !s.priceShock)) return tape;
  let rows = tape.map(x => Object.assign({}, x));
  if (s.notches) rows.forEach(x => { if (String(x.defaulted).toUpperCase() !== 'Y' && x.defaulted !== true) { x.moodysDPR = notchM(x.moodysDPR, s.notches); x.moodysFacility = notchM(x.moodysFacility || x.moodysDPR, s.notches); const si = Math.max(0, Math.min(SS.length - 1, SS.indexOf(String(x.spRating).toUpperCase()) + s.notches)); x.spRating = SS[si] || x.spRating; } });
  if (s.priceShock) rows.forEach(x => { if (String(x.defaulted).toUpperCase() !== 'Y') x.price = Math.max(1, (+x.price || 100) - s.priceShock); });
  if (s.extraDefaultPct) applyDefaults(rows, [{ share: s.extraDefaultPct / 100, price: s.defaultPrice || 45, date: asOf }]);
  return rows;
}

function subHistory(pairs) { return pairs.map(([date, amount]) => ({ date, amount })); }
function quarterlyHistory(from, to, f) { const out = []; let d = from; let k = 0; while (d <= to) { out.push({ date: d, amount: Math.round(f(d, k) / 1000) * 1000 }); const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + 3); d = t.toISOString().slice(0, 10); k++; } return out; }

function scenarios() {
  const base2007 = makeTape({ seed: 2007, par: 398500000 });
  const t1 = base2007.map(x => Object.assign({}, x));

  // Apr 2009: credit crisis — downgrades, defaults, discount purchases, 1.2% LIBOR
  let t2 = stressTape(base2007, { seed: 2009, downgradeShare: 0.34 });
  t2 = applyDefaults(t2, [{ share: 0.034, price: 42, date: '2009-01-20' }]);
  // a few discount obligations bought in Q4 2008 with reinvested principal
  const disc = makeTape({ seed: 2008, par: 9000000, sizeMin: 0.2, sizeRange: 0.3, ratingW: [0, 0, 10, 30, 40, 20], price: (r) => 70 + r() * 6, purchase: (r) => 68 + r() * 9 });
  disc.forEach((x, k) => { x.id = 'R' + String(k + 1).padStart(3, '0'); x.obligor = x.obligor.replace(/(\S+)/, '$1 Acquisition'); });
  t2 = t2.concat(disc);

  // Oct 2016: post-reinvestment amortisation; portfolio refreshed during 2010–2014
  const t3 = makeTape({ seed: 2014, par: 256000000, vintage: 2013, matStart: 5, matSpread: 3, matMonths: 12, sizeMin: 0.0045, sizeRange: 1.1, covLite: 0.10, spreadBase: 2.75, spreadRange: 1.4, ratingW: [2, 14, 30, 34, 16, 4], price: (r) => 96.5 + r() * 3.5, purchase: (r) => 98.5 + r() * 1.5 });
  applyDefaults(t3, [{ share: 0.012, price: 55, date: '2016-05-10' }]);

  const hist2009 = subHistory([['2008-01-18', 2950000], ['2008-04-18', 2150000], ['2008-07-18', 2240000], ['2008-10-18', 2080000], ['2009-01-18', 1390000]]);
  const hist2016 = quarterlyHistory('2008-01-18', '2016-07-18', (d) => {
    if (d === '2008-01-18') return 2950000; if (d < '2009-01-01') return 2150000; if (d < '2010-01-01') return d < '2009-07-01' ? 0 : 650000;
    if (d < '2014-08-01') return 2900000 + (d.charCodeAt(3) % 3) * 120000; return 2350000;
  });

  const notesFull = { A: { bal: 304000000, def: 0 }, B: { bal: 30000000, def: 0 }, C: { bal: 25000000, def: 0 }, D: { bal: 13000000, def: 0 }, E: { bal: 12500000, def: 0 } };
  const common = { taxes: 0, hedgePayment: 0, hedgeTermSenior: 0, hedgeTermSub: 0, unpaidSeniorFees: 0, unpaidSubFee: 0, subFeeDeferElect: 0, subFeeDeferTo: 'interest', cumDeferredFee: 0, recoupCumDeferred: 0, rcf: false, rcfAmount: 0, specialRedemption: 0, reinvestElect: 0, principalCashInPCV: true, mode: 'regular', liquidationProceeds: 0, interestProceeds: null, feeBasis: null };
  return [
    { id: 'jan08', label: 'Jan 2008 — first Payment Date', blurb: 'Freshly ramped portfolio. IC tests do not apply yet; principal is reinvested.', tape: t1,
      inputs: Object.assign({}, common, { paymentDate: '2008-01-18', libor: 5.10, principalProceeds: 2600000, adminDue: 165000, adminPaidPrior: 0, notes: JSON.parse(JSON.stringify(notesFull)), subHistory: [], selections: { moodysModifier: 45, spCase: 3, external: {} } }) },
    { id: 'apr09', label: 'Apr 2009 — credit stress', blurb: 'Defaults, CCC downgrades and discount purchases eat the OC cushion. Watch interest divert from equity.', tape: t2,
      inputs: Object.assign({}, common, { paymentDate: '2009-04-18', libor: 1.22, principalProceeds: 3100000, adminDue: 140000, adminPaidPrior: 300000, notes: JSON.parse(JSON.stringify(notesFull)), subHistory: hist2009, selections: { moodysModifier: 45, spCase: 3, external: {} } }) },
    { id: 'oct16', label: 'Oct 2016 — amortisation', blurb: 'After the Reinvestment Period: principal pays Class A sequentially and the equity has cleared its 11% hurdle.', tape: t3,
      inputs: Object.assign({}, common, { paymentDate: '2016-10-18', libor: 0.85, principalProceeds: 17800000, adminDue: 118000, adminPaidPrior: 205000, notes: { A: { bal: 145500000, def: 0 }, B: { bal: 30000000, def: 0 }, C: { bal: 25000000, def: 0 }, D: { bal: 13000000, def: 0 }, E: { bal: 12500000, def: 0 } }, subHistory: hist2016, selections: { moodysModifier: 48, spCase: 6, external: {} } }) }
  ];
}

// Each step cites its clause in Section 11.1 (Priority of Payments) of the fictional indenture
{ const W = { interest: 'Section 11.1(a)(i)', principal: 'Section 11.1(a)(ii)', liquidation: 'Section 11.1(a)(iii)' };
  const PAGE = { interest: id => id <= 'H' ? 9 : id <= 'Q' ? 10 : 11, principal: id => id <= 'H' ? 11 : 12, liquidation: id => id <= 'I' ? 12 : 13 }; // pages of the sample indenture
  Object.keys(W).forEach(k => EXAMPLE_CLO.waterfalls[k].forEach(st => { st.section = W[k] + '(' + st.id + ')'; st.ref = 'page ' + PAGE[k](st.id); })); }
const api = { EXAMPLE_CLO, scenarios, makeTape, applyStress };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CLOData = api;
})(typeof window !== 'undefined' ? window : globalThis);
