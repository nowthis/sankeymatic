// constants.js: Reference file with several values used in sankeymatic.js
/* eslint-disable no-unused-vars */

const MAXBREAKPOINT = 9999,
// skmSettings = Settings required to render a diagram.
// Format = field_name: [data type, initial value, allowed values]
// 'Allowed values' contains different things per data type:
//   whole = [min, [max]], always >= 0
//   integer = [min, [max]], can be negative
//   contained = [min, dimension to compare to (either 'h' or 'w')]
//   breakpoint = [min]
//   text = [min-length, max-length]
//   radio & list = [literal list of allowed values]
// These types' constraints are NOT specified here; they are enforced in code:
//   decimal = always 0.0 - 1.0
//   color = always a hex color spec
//   yn = always y or n
// ** CAUTION **: Never make an skmSetting with a suffix that is *also*
// an skmObjectType (like .._node or .._flow or .._stage). That will
// break one of the assumptions we make when parsing settings.
  skmSettings
    = new Map([
    ['size_w', ['whole', 600, [40]]],
    ['size_h', ['whole', 600, [40]]],
    ['margin_l', ['contained', 12, [0, 'w']]],
    ['margin_r', ['contained', 12, [0, 'w']]],
    ['margin_t', ['contained', 18, [0, 'h']]],
    ['margin_b', ['contained', 20, [0, 'h']]],
    ['bg_color', ['color', '#ffffff', []]],
    ['bg_transparent', ['yn', 'n', []]],
    ['node_w', ['contained', 9, [0, 'w']]],
    ['node_h', ['half', 50, [0, 100]]],
    ['node_spacing', ['half', 85, [0, 100]]],
    ['node_border', ['contained', 0, [0, 'w']]],
    ['node_theme', ['radio', 'none', ['a', 'b', 'c', 'd', 'none']]],
    ['node_color', ['color', '#888888', []]],
    ['node_opacity', ['decimal', 1.0, []]],
    ['flow_curvature', ['decimal', 0.5, []]],
    ['flow_inheritfrom', ['radio', 'none', ['source', 'target', 'outside-in', 'none']]],
    ['flow_color', ['color', '#999999', []]],
    ['flow_opacity', ['decimal', 0.45, []]],
    ['layout_order', ['radio', 'automatic', ['automatic', 'exact']]],
    ['layout_justifyorigins', ['yn', 'n', []]],
    ['layout_justifyends', ['yn', 'n', []]],
    ['layout_reversegraph', ['yn', 'n', []]],
    ['layout_attachincompletesto', ['radio', 'nearest', ['leading', 'nearest', 'trailing']]],
    ['labels_color', ['color', '#000000', []]],
    ['labels_hide', ['yn', 'n', []]],
    ['labels_highlight', ['decimal', 0.75, []]],
    ['labels_fontface', ['radio', 'sans-serif', ['monospace', 'sans-serif', 'serif']]],
    ['labels_linespacing', ['decimal', 0.15, []]],
    ['labels_relativesize', ['whole', 100, [50, 150]]],
    ['labels_magnify', ['whole', 100, [50, 150]]],
    ['labelname_appears', ['yn', 'y', []]],
    ['labelname_size', ['half', 16, [6]]],
    ['labelname_weight', ['whole', 400, [100, 700]]],
    ['labelvalue_appears', ['yn', 'y', []]],
    ['labelvalue_fullprecision', ['yn', 'y', []]],
    ['labelvalue_position', ['radio', 'below', ['above', 'before', 'after', 'below']]],
    ['labelvalue_weight', ['whole', 400, [100, 700]]],
    ['labelposition_autoalign', ['integer', 0, [-1, 1]]],
    ['labelposition_scheme', ['radio', 'auto', ['auto', 'per_stage']]],
    ['labelposition_first', ['radio', 'before', ['before', 'after']]],
    ['labelposition_breakpoint', ['breakpoint', MAXBREAKPOINT, [2]]],
    ['value_format', ['list', ',.', [',.', '.,', ' .', ' ,', 'X.', 'X,']]],
    ['value_prefix', ['text', '', [0, 99]]],
    ['value_suffix', ['text', '', [0, 99]]],
    ['themeoffset_a', ['whole', 9, [0, 9]]],
    ['themeoffset_b', ['whole', 0, [0, 9]]],
    ['themeoffset_c', ['whole', 0, [0, 7]]],
    ['themeoffset_d', ['whole', 0, [0, 11]]],
    ['meta_mentionsankeymatic', ['yn', 'y', []]],
    ['meta_listimbalances', ['yn', 'y', []]],
    // 'internal' settings are never exported, but can be imported:
    ['internal_iterations', ['whole', 25, [0, 50]]],
    ['internal_revealshadows', ['yn', 'n', []]],
  ]),

  // Some reusable regular expressions to be precompiled:
  reWholeNumber = /^\d+$/,
  reHalfNumber = /^\d+(?:\.5)?$/,
  reInteger = /^-?\d+$/,
  reDecimal = /^\d(?:.\d+)?$/,
  reCommentLine = /^(?:'|\/\/)/, // Line starts with // or '
  reYesNo = /^(?:y|yes|n|no)/i, // = Y/y/Yes/YES/etc. or N/n/No/NO/etc.
  reYes = /^(?:y|yes)/i,        // = Y/y/Yes/YES/etc.

  // Settings Notes:
  //   * We look for settings & move lines FIRST.
  //   * If they prove valid, we apply them to the UI and convert them to
  //     COMMENTS in the input (with a checkmark to indicate success).
  //   * The idea here is to avoid having input text conflicting with
  //     the UI controls. Since any valid setting line is immediately
  //     applied and disappears, we can't have a conflict.
  //
  // reSettingsValue:
  // One to two words, followed by a value made up of letters,
  // numbers, decimals and/or dashes.
  // ex. "node theme a", "flow inheritfrom outside-in"
  reSettingsValue = /^((?:\w+\s*){1,2}) (#?[\w.-]+)$/,

  // reSettingsText:
  // One to two words followed by a quoted string (possibly empty):
  // ex: "value prefix ''", "suffix 'M'"
  // If the raw string contains a single quote, it will be doubled here.
  reSettingsText = /^((?:\w+\s*){1,2}) '(.*)'$/,
  reMoveLine = /^move (.+) (-?\d(?:.\d+)?), (-?\d(?:.\d+)?)$/,

  sourceHeaderPrefix = '// SankeyMATIC diagram inputs -',
  sourceURLLine = '// https://sankeymatic.com/build/',
  userDataMarker = '// === Nodes and Flows ===',
  movesMarker = '// === Moved Nodes ===',
  settingsMarker = '// === Settings ===',
  settingsAppliedPrefix = '// \u2713 ', // u2713 = a little check mark

  // If someone is importing/linking a diagram which was made *BEFORE*
  // the newest settings existed, prefix the incoming source with these
  // lines so that their diagram will still look like it did when they
  // made it.
  // (The trick here is that if their diagram was made AFTER the new
  // settings appeared, then values for these settings will be present
  // later in the incoming source data and will override these lines.)
  settingsToBackfill = `labelvalue position after
labelposition scheme per_stage
labels relativesize 100
 magnify 100
`,

  // Node definitions:
  NODE_OBJ = 'node', // for easy referencing
  // - Loose: ":my node name #color <<""
  reNodeLineLoose
    = /^:(.+) #([a-f0-9]{0,6})?(\.\d{1,4})?\s*(>>|<<)*\s*(>>|<<)*$/i,
  // - Strict: "node myNodeName" (no spaces or dots), then attribute lines
  reNodeLineStrict = new RegExp(`^${NODE_OBJ}\\s+([^ .]+)$`,'i'),

  // Attribute lines look like: ".command value"
  // Examples: .label "", (future:) .color lightseagreen, .minvalue 1000
  reAttributeLine = /^\.([a-z]+)\s+(.+)$/i,
  // validAttributes map: skmObjectType => Set([valid attribute strings])
  validAttributes = new Map([[NODE_OBJ, new Set(['label'])]]),

  reFlowTargetWithSuffix = /^(.+)\s+(#\S+)$/,

  reColorPlusOpacity = /^#([a-f0-9]{3,6})?(\.\d{1,4})?$/i,
  reBareColor = /^(?:[a-f0-9]{3}|[a-f0-9]{6})$/i,
  reRGBColor = /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i,
  colorGray60 = '#999',

  userInputsField = 'flows_in',
  breakpointField = 'labelposition_breakpoint',

  // Some prime constants for enum values:
  [IN, OUT, BEFORE, AFTER] = [13, 17, 19, 23],

  // fontMetrics = measurements relating to labels & their highlights
  //   Structure:
  //     browserKey ('firefox' or '*')
  //       -> font-face or '*'
  //         -> values
  //   Value list:
  //     - dy: what fraction of the BoundingBox to lower labels to make them
  //       vertically-centered relative to their Node
  //     - top, bot: how many x-heights to pad above/below the BoundingBox
  //     - inner: how many em-widths to pad between the label and the
  //       highlight's edge (could be on the left or right)
  //     - outer: how many em-widths to pad at the end furthest from the Node
  //     - marginRight: what multiple of 'inner' to move labels to the right
  //     - marginAdjLeft: offset to add to marginRight when moving labels
  //       to left
  fontMetrics
  = {
    firefox: {
      'sans-serif': {
        dy: 0.35, top: 0.55, bot: 0.25, inner: 0.35, outer: 0.35,
        marginRight: 1.4, marginAdjLeft: 0,
        },
      monospace: {
        dy: 0.31, top: 0.3, bot: 0.25, inner: 0.35, outer: 0.35,
        marginRight: 1.48, marginAdjLeft: -0.08,
        },
      '*': {
        dy: 0.31, top: 0.3, bot: 0.25, inner: 0.35, outer: 0.35,
        marginRight: 1.35, marginAdjLeft: -0.05,
        },
    },
    '*': {
      monospace: {
        dy: 0.28, top: 0.3, bot: 0.3, inner: 0.35, outer: 0.38,
        marginRight: 1.45, marginAdjLeft: 0,
        },
      '*': {
        dy: 0.29, top: 0.3, bot: 0.3, inner: 0.35, outer: 0.38,
        marginRight: 1.35, marginAdjLeft: 0,
        },
    },
  },

  // highlightStyles = settings relating to label highlight appearance
  //   Structure:
  //     mode ('dark' or 'light')
  //       -> state ('orig' or 'hover')
  //         -> values (directly applied as SVG attributes)
  highlightStyles
  = {
    // When text is dark-on-light:
    dark: {
      orig: { fill: '#fff', stroke: 'none', stroke_width: 0, stroke_opacity: 0 },
      hover: { fill: '#ffb', stroke: '#440', stroke_width: 1, stroke_opacity: 0.7 },
    },
    // When text is light-on-dark:
    light: {
      orig: { fill: '#000', stroke: 'none', stroke_width: 0, stroke_opacity: 0 },
      hover: { fill: '#603', stroke: '#fff', stroke_width: 1.7, stroke_opacity: 0.9 },
    },
  },

  // sampleDiagramRecipes = preset diagrams of various types.
  //
  // Planning to make these more elaborate / sophisticated as the tool's
  // capabilities improve...
  //
  // These contain some super-long string literals; I preferred that to
  // making this a very /tall/ file with a difficult-to-follow structure.
  sampleDiagramRecipes
    = new Map([
    // The initial diagram loaded on the page:
    ['default_budget', {
      name: 'Basic Budget',
      flows: "// Enter Flows between Nodes, like this:\n//         Source [AMOUNT] Target\n\nWages [1500] Budget\nOther [250] Budget\n\nBudget [450] Taxes\nBudget [420] Housing\nBudget [400] Food\nBudget [255] Transportation\n\n// You can set a Node's color, like this:\n:Budget #057\n//            ...or a color for a single Flow:\nBudget [160] Other Necessities #606\n\n// \"[*]\" means \"Use any amount left over\":\nBudget [*] Savings\n\n// Use the controls below to customize\n// your diagram's appearance...",
      settings: {
        size_h: 600,
        size_w: 600,
        node_w: 12,
        node_h: 50,
        node_spacing: 75,
        node_border: 0,
        node_color: '#777777',
        node_theme: 'a',
        flow_inheritfrom: 'outside-in',
        layout_justifyends: 'n',
        layout_order: 'automatic',
        labelname_size: 16,
        labelname_weight: 400,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 0,
        labels_highlight: 0.8,
        labels_magnify: 100,
        labels_relativesize: 110,
        labelvalue_appears: 'y',
        labelvalue_position: 'below',
        themeoffset_a: 6,
        value_prefix: '',
        },
    }],

    // Ranked-choice election:
    ['election', {
      name: 'Ranked Election',
      flows: '// Sample Ranked Election diagram\n\nGH\\nRound 1 [300000] GH\\nRound 2\nEF\\nRound 1 [220000] EF\\nRound 2\nCD\\nRound 1 [200000] CD\\nRound 2\nAB\\nRound 1 [10000] GH\\nRound 2\nAB\\nRound 1 [25000] EF\\nRound 2\nAB\\nRound 1 [20000] CD\\nRound 2\n\nGH\\nRound 2 [310000] GH\\nRound 3\\nProjected Winner\nEF\\nRound 2 [245000] EF\\nRound 3\nCD\\nRound 2 [50000] GH\\nRound 3\\nProjected Winner\nCD\\nRound 2 [95000] EF\\nRound 3\n\n// This line sets a custom gray color:\n:No further votes #555 <<\nCD\\nRound 2 [75000] No further votes\nAB\\nRound 1 [20000] No further votes',
      settings: {
        size_h: 600,
        size_w: 700,
        node_w: 10,
        node_h: 76,
        node_spacing: 85,
        node_border: 0,
        node_theme: 'a',
        flow_inheritfrom: 'source',
        layout_justifyends: 'n',
        layout_order: 'exact',
        labelname_size: 14,
        labelname_weight: 700,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 0,
        labels_highlight: 0.8,
        labels_magnify: 105,
        labels_relativesize: 110,
        labelvalue_appears: 'y',
        labelvalue_position: 'below',
        themeoffset_a: 9,
        value_prefix: '',
        },
    }],

    // Sample job-hunt flow:
    ['job_search', {
      name: 'Job Search',
      flows: '// Sample Job Search diagram:\n\nApplications [4] 1st Interviews\nApplications [9] Rejected\nApplications [4] No Answer\n\n1st Interviews [2] 2nd Interviews\n1st Interviews [2] No Offer\n\n2nd Interviews [2] Offers\n\nOffers [1] Accepted\nOffers [1] Declined',
      settings: {
        size_h: 600,
        size_w: 700,
        node_w: 8,
        node_h: 60,
        node_spacing: 55,
        node_border: 0,
        node_theme: 'a',
        flow_inheritfrom: 'target',
        layout_justifyends: 'n',
        layout_order: 'automatic',
        labelname_size: 17,
        labelname_weight: 400,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 1,
        labels_highlight: 0.55,
        labels_magnify: 95,
        labels_relativesize: 120,
        labelvalue_appears: 'y',
        labelvalue_position: 'above',
        themeoffset_a: 6,
        value_prefix: '',
        },
    }],

    // Sample quarterly financial results:
    ['financial_results', {
      name: 'Financial Results',
      flows: '// Sample Financial Results diagram:\n\nDivisionA [900] Revenue\nDivisionB [750] Revenue\nDivisionC [150] Revenue\n\nRevenue [800] Cost of Sales\nRevenue [1000] Gross Profit\n\nGross Profit [10] Amortization\nGross Profit [640] Selling, General &\\nAdministration\nGross Profit [350] Operating Profit\n\nOperating Profit [90] Tax\nOperating Profit [260] Net Profit\n\n// Profit - blue\n:Gross Profit #48e <<\n:Operating Profit #48e <<\n:Net Profit #48e <<\n\n// Expenses - rust\n:Tax #d97 <<\n:Selling, General &\\nAdministration #d97 <<\n:Amortization #d97 <<\n\n// Cost - gray\n:Cost of Sales #bbb <<\n\n// main Revenue node: dark grey\n:Revenue #555',
      settings: {
        size_h: 600,
        size_w: 900,
        node_w: 20,
        node_h: 75,
        node_spacing: 30,
        node_border: 2,
        node_theme: 'b',
        flow_inheritfrom: 'source',
        layout_justifyends: 'n',
        layout_order: 'automatic',
        labelname_size: 18,
        labelname_weight: 400,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 0,
        labels_highlight: 0.8,
        labels_magnify: 113,
        labels_relativesize: 116,
        labelvalue_appears: 'y',
        labelvalue_position: 'below',
        themeoffset_b: 3,
        value_prefix: '$',
        },
    }],

    // The most basic diagram:
    ['simple_start', {
      name: 'Start Simple',
      flows: 'a [1] b\na [1] c',
      settings: {
        size_h: 600,
        size_w: 600,
        node_w: 12,
        node_h: 50,
        node_spacing: 80,
        node_border: 0,
        node_theme: 'none',
        flow_inheritfrom: 'none',
        layout_justifyends: 'n',
        layout_order: 'automatic',
        labelname_size: 18,
        labelname_weight: 400,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 0,
        labels_highlight: 0.75,
        labels_magnify: 100,
        labels_relativesize: 100,
        labelvalue_appears: 'y',
        labelvalue_position: 'after',
        value_prefix: '',
        },
    }],

    // Stable, traceable journey:
    ['journey', {
      name: 'Journey',
      flows: '// List each player\'s moves all at once\n// Use one color for each player\n// Use an amount of 1 for each move\n// Check "Using the exact input order" below\n\n// Experiment with reordering players!\n\n:Player 1: #76a\nPlayer 1: [1] 1A #76a\n1A [1] 2C #76a\n2C [1] 3E #76a\n3E [1] Player 1 #76a\n:Player 1 #76a\n\n:Player 2: #e37\nPlayer 2: [1] 1B #e37\n1B [1] 2D #e37\n2D [1] 3E #e37\n3E [1] Player 2 #e37\n:Player 2 #e37\n\n:Player 3: #bb2\nPlayer 3: [1] 1A #bb2\n1A [1] 2D #bb2\n2D [1] 3E #bb2\n3E [1] Player 3 #bb2\n:Player 3 #bb2\n',
      settings: {
        size_h: 400,
        size_w: 600,
        node_w: 12,
        node_h: 23,
        node_spacing: 46,
        node_border: 0,
        node_theme: 'none',
        node_color: '#777777',
        flow_inheritfrom: 'outside-in',
        layout_justifyends: 'y',
        layout_order: 'exact',
        labelname_size: 16,
        labelname_weight: 400,
        labelposition_scheme: 'auto',
        labelposition_autoalign: 0,
        labels_highlight: 0.75,
        labels_magnify: 100,
        labels_relativesize: 100,
        labelvalue_appears: 'n',
        labelvalue_position: 'below',
        themeoffset_a: 9,
        value_prefix: '',
        },
    }],

    // A variation of the inputs for the original d3 energy diagram, now found
    // at https://observablehq.com/@d3/sankey:
    // (This will become another button at some point.)
    // ['energy_flows_all', {
    //   name: 'Energy Flows',
    // eslint-disable-next-line max-len
    //   flows: ":Losses #900 <<\n:Coal #444 <<\nAgricultural 'waste' [124.729] Bio-conversion\nBio-conversion [0.597] Liquid\nBio-conversion [26.862] Losses\nBio-conversion [280.322] Solid\nBio-conversion [81.144] Gas\nBiofuel imports [35] Liquid\nBiomass imports [35] Solid\nCoal imports [11.606] Coal\nCoal reserves [63.965] Coal\nCoal [75.571] Solid\nDistrict heating [10.639] Industry\nDistrict heating [22.505] Heating and cooling - commercial\nDistrict heating [46.184] Heating and cooling - homes\nElectricity grid [104.453] Over generation / exports\nElectricity grid [113.726] Heating and cooling - homes\nElectricity grid [27.14] H2 conversion\nElectricity grid [342.165] Industry\nElectricity grid [37.797] Road transport\nElectricity grid [4.412] Agriculture\nElectricity grid [40.858] Heating and cooling - commercial\nElectricity grid [56.691] Losses\nElectricity grid [7.863] Rail transport\nElectricity grid [90.008] Lighting & appliances - commercial\nElectricity grid [93.494] Lighting & appliances - homes\nGas imports [40.719] Ngas\nGas reserves [82.233] Ngas\nGas [0.129] Heating and cooling - commercial\nGas [1.401] Losses\nGas [151.891] Thermal generation\nGas [2.096] Agriculture\nGas [48.58] Industry\nGeothermal [7.013] Electricity grid\nH2 conversion [20.897] H2\nH2 conversion [6.242] Losses\nH2 [20.897] Road transport\nHydro [6.995] Electricity grid\nLiquid [121.066] Industry\nLiquid [128.69] International shipping\nLiquid [135.835] Road transport\nLiquid [14.458] Domestic aviation\nLiquid [206.267] International aviation\nLiquid [3.64] Agriculture\nLiquid [33.218] National navigation\nLiquid [4.413] Rail transport\nMarine algae [4.375] Bio-conversion\nNgas [122.952] Gas\nNuclear [839.978] Thermal generation\nOil imports [504.287] Oil\nOil reserves [107.703] Oil\nOil [611.99] Liquid\nOther waste [56.587] Solid\nOther waste [77.81] Bio-conversion\nPumped heat [193.026] Heating and cooling - homes\nPumped heat [70.672] Heating and cooling - commercial\nSolar PV [59.901] Electricity grid\nSolar Thermal [19.263] Heating and cooling - homes\nSolar [19.263] Solar Thermal\nSolar [59.901] Solar PV\nSolid [0.882] Agriculture\nSolid [400.12] Thermal generation\nSolid [46.477] Industry\nThermal generation [525.531] Electricity grid\nThermal generation [787.129] Losses\nThermal generation [79.329] District heating\nTidal [9.452] Electricity grid\nUK land based bioenergy [182.01] Bio-conversion\nWave [19.013] Electricity grid\nWind [289.366] Electricity grid",
    //   settings: {},
    // }],
  ]);
