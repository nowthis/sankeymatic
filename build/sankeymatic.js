/*
SankeyMATIC
A Sankey diagram builder for everyone
by Steve Bogart (@nowthis; http://nowthis.com/; sbogart@sankeymatic.com)

Requires:
  D3.js
    - https://github.com/d3/d3 v7.3.0
  canvg.js
    - https://github.com/canvg/canvg v3.0.9
*/

(function sankeymatic(glob) {
'use strict';

// 'glob' points to the global object, either 'window' (browser) or 'global' (node.js)
// This lets us contain everything in an IIFE (Immediately-Invoked Function Expression)

// el: shorthand for grabbing a DOM element, often to modify it
// elV: used if all we want is to READ the .value
function el(domId) { return document.getElementById(domId); }
function elV(domId) { return document.getElementById(domId).value; }

// togglePanel: Called directly from the page.
// Given a panel's name, hide or show that control panel.
glob.togglePanel = (panel) => {
  const panelEl = el(panel),
    // Set up the new values:
    newVals = panelEl.style.display === 'none'
      ? { display: '', suffix: ':', action: String.fromCharCode(8211) }
      : { display: 'none', suffix: '...', action: '+' };
  panelEl.style.display = newVals.display;
  el(`${panel}_hint`).textContent = newVals.suffix;
  el(`${panel}_indicator`).textContent = newVals.action;
  return null;
};

function outputFieldEl(fld) { return el(`${fld}_val`); }

// updateOutput: Called directly from the page.
// Given a field's name, update the visible value shown to the user.
glob.updateOutput = (fld) => {
  const fldVal = elV(fld),
    oEl = outputFieldEl(fld),
    formats = {
      curvature: '|',
      default_node_opacity: '.2',
      default_flow_opacity: '.2',
      label_highlight: '.2',
      node_height: '%',
      node_spacing: '%',
    };
  switch (formats[fld]) {
    case '|':
      // 0.1 is treated as 0 for curvature. Display that:
      if (fldVal <= 0.1) { oEl.textContent = '0.00'; break; }
      // FALLS THROUGH to '.2' format when fldVal > 0.1:
    case '.2': oEl.textContent = d3.format('.2f')(fldVal); break;
    case '%': oEl.textContent = `${fldVal}%`; break;
    default: oEl.textContent = fldVal;
  }
  return null;
};

glob.revealVal = (fld) => {
  // First make sure the value is up to date.
  glob.updateOutput(fld);

  // Swap classes to make the output appear:
  const cl = outputFieldEl(fld).classList;
  cl.remove('fade-init', 'fade-out');
  cl.add('fade-in');
  return null;
};

glob.fadeVal = (fld) => {
  outputFieldEl(fld).classList.replace('fade-in', 'fade-out');
  return null;
};

// isNumeric: borrowed from jQuery/Angular
function isNumeric(n) { return !Number.isNaN(n - parseFloat(n)); }

// clamp: Ensure a numeric value n is between min and max.
// Default to min if not numeric.
function clamp(n, min, max) {
  return isNumeric(n) ? Math.min(Math.max(n, min), max) : min;
}

// radioRef: get the object which lets you get/set a radio input value:
function radioRef(rId) { return document.forms.skm_form.elements[rId]; }

// checkRadio: Given a radio field's id, check it.
glob.checkRadio = (id) => { el(id).checked = true; };

// rememberedMoves: Used to track the user's repositioning of specific nodes
// (which should be preserved across diagram renders).
// Format is: nodeName => [moveX, moveY]
glob.rememberedMoves = new Map();

// resetMovesAndRender: Clear all manual moves of nodes AND re-render the
// diagram:
glob.resetMovesAndRender = () => {
  glob.rememberedMoves.clear();
  glob.process_sankey();
  return null;
};

function updateResetNodesUI() {
  // Check whether we should enable the 'reset moved nodes' button:
  el('reset_all_moved_nodes').disabled = !glob.rememberedMoves.size;
}

// contrasting_gray_color:
// Given any hex color, return a grayscale color which is lower-contrast than
// pure black/white but still sufficient. (Used for less-important text.)
function contrasting_gray_color(hc) {
  const c = d3.rgb(hc),
    yiq = (c.r * 299 + c.g * 587 + c.b * 114) / 1000,
    // Calculate a value sufficiently far away from this color.
    // If it's bright-ish, make a dark gray; if dark-ish, make a light gray.
    // This algorithm is far from exact! But it seems good enough.
    // Lowest/highest values produced are 59 and 241.
    gray = Math.floor(yiq > 164 ? (0.75 * yiq) - 64 : (0.30 * yiq) + 192);
  return d3.rgb(gray, gray, gray);
}

// escapeHTML: make any input string safe to display.
// Used for displaying raw <SVG> code
// and for reflecting the user's input back to them in messages.
function escapeHTML(unsafeString) {
  return unsafeString
     .replaceAll('→', '&#8594;')
     .replaceAll('&', '&amp;')
     .replaceAll('<', '&lt;')
     .replaceAll('>', '&gt;')
     .replaceAll('"', '&quot;')
     .replaceAll("'", '&#039;')
     .replaceAll('\n', '<br />');
}

// ep = "Enough Precision". Converts long decimals to have just 5 digits.
// Why?:
// SVG diagrams produced by SankeyMATIC don't really benefit from specifying
// values with more than 3 decimal places, but by default the output has *13*.
// This is frankly hard to read and actually inflates the size of the SVG
// output by quite a bit.
//
// Result: values like 216.7614485930364 become 216.76145 instead.
// The 'Number .. toString' call allows shortened output: 8 instead of 8.00000
function ep(x) { return Number(x.toFixed(5)).toString(); }

// updateMarks: given a US-formatted number string, replace with user's
// preferred separators:
function updateMarks(stringIn, numberMarks) {
  // If the digit-group mark is a comma, implicitly the decimal is a dot...
  // That's what we were given, so return:
  if (numberMarks.group === ',') { return stringIn; }

  // Perform hacky mark swap using ! as a placeholder:
  return stringIn.replaceAll(',', '!')
    .replaceAll('.', numberMarks.decimal)
    .replaceAll('!', numberMarks.group);
}

// formatUserData: produce a value in the user's designated format:
function formatUserData(numberIn, nStyle) {
  const nString = updateMarks(
    d3.format(`,.${nStyle.decimalPlaces}${nStyle.trimString}f`)(numberIn),
    nStyle.marks
  );
  return `${nStyle.prefix}${nString}${nStyle.suffix}`;
}

// initializeDiagram: Reset the SVG tag to have the chosen size &
// background (with a pattern showing through if the user wants it to be
// transparent):
function initializeDiagram(cfg) {
  const svgEl = el('sankey_svg');
  svgEl.setAttribute('height', cfg.canvas_height);
  svgEl.setAttribute('width', cfg.canvas_width);
  svgEl.setAttribute(
    'class',
    cfg.background_transparent
      ? 'svg_background_transparent'
      : 'svg_background_default'
    );
  svgEl.textContent = ''; // Someday use replaceChildren() instead
}

// render_png: Build a PNG file in the background
function render_png(curDate) {
  const chartEl = el('chart'),
    orig = { w: chartEl.clientWidth, h: chartEl.clientHeight },
    // What scale does the user want (1,2,4,6)?:
    scaleFactor = clamp(elV('scale_x'), 1, 6),
    scaled = { w: orig.w * scaleFactor, h: orig.h * scaleFactor },
    // Canvg 3 needs interesting offsets added when scaling up:
    offset = {
      x: (scaled.w - orig.w) / (2 * scaleFactor),
      y: (scaled.h - orig.h) / (2 * scaleFactor),
    },
    // Find the (hidden) canvas element in our page:
    canvasEl = el('png_preview'),
    canvasContext = canvasEl.getContext('2d'),
    svgContent = (new XMLSerializer()).serializeToString(el('sankey_svg'));

  // Set the canvas element to the final height/width the user wants:
  canvasEl.width = scaled.w;
  canvasEl.height = scaled.h;

  // Give Canvg what it needs to produce a rendered image:
  const canvgObj = canvg.Canvg.fromString(
    canvasContext,
    svgContent,
    {
      ignoreMouse: true,
      ignoreAnimation: true,
      ignoreDimensions: true, // DON'T make the canvas size match the svg
      scaleWidth: scaled.w,
      scaleHeight: scaled.h,
      offsetX: offset.x,
      offsetY: offset.y,
    }
  );
  canvgObj.render();

  // Turn canvg's output into a PNG:
  const pngLinkEl = el('download_png_link'),
    // Generate yyyymmdd_hhmmss string:
    fileTimestamp
      = (curDate.toISOString().replace(/T.+$/, '_')
      + curDate.toTimeString().replace(/ .+$/, ''))
        .replace(/[:-]/g, '');
  // Convert canvas image to a URL-encoded PNG and update the link:
  pngLinkEl.setAttribute('href', canvasEl.toDataURL('image/png'));
  // update download link & filename with dimensions:
  pngLinkEl.textContent = `Export ${scaled.w} x ${scaled.h} PNG`;
  pngLinkEl.setAttribute('download', `sankeymatic_${fileTimestamp}_${scaled.w}x${scaled.h}.png`);

  // Update img tag hint with the user's original dimensions:
  el('img_tag_hint_w').textContent = orig.w;
  el('img_tag_hint_h').textContent = orig.h;
}

// produce_svg_code: take the current state of 'sankey_svg' and
// relay it nicely to the user
function produce_svg_code(curDate) {
  // For the user-facing SVG code, make a copy of the real SVG & make a
  // few small changes:
  const svgForCopying
  = el('sankey_svg').outerHTML
    // Take out the id and the class declaration for the background:
    .replace(' id="sankey_svg"', '')
    .replace(/ class="svg_background_[a-z]+"/, '')
    // Add a title placeholder & credit comment after the FIRST tag:
    .replace(
      />/,
      '>\r\n<title>Your Diagram Title</title>\r\n'
      + `<!-- Generated with SankeyMATIC: ${curDate.toLocaleString()} -->\r\n`
      )
    // Add some line breaks to highlight where [g]roups start/end
    // and where each path/text/rect begins:
    .replace(/><(g|\/g|path|text|rect)/g, '>\r\n<$1');
  // Display the result in the <div> as text for copying:
  el('svg_for_export').textContent = svgForCopying;
}

// Functions for generating SVG path specs:

// flatFlowPathMaker(f):
// Returns an SVG path drawing a parallelogram between 2 nodes.
// Used for the "d" attribute on a "path" element when curvature = 0 OR
// when there is no curve to usefully draw (i.e. the flow is ~horizontal).
function flatFlowPathMaker(f) {
  const sx = f.source.x + f.source.dx, // source's trailing edge
    tx = f.target.x,                   // target's leading edge
    syTop = f.source.y + f.sy,         // source flow top
    tyBot = f.target.y + f.ty + f.dy;  // target flow bottom

  f.renderAs = 'flat'; // Render this path as a filled parallelogram

  // This SVG Path spec means:
  // [M]ove to the flow source's top; draw a [v]ertical line down,
  // a [L]ine to the opposite corner, a [v]ertical line up,
  // then [z] close.
  return `M${ep(sx)} ${ep(syTop)}v${ep(f.dy)}`
    + `L${ep(tx)} ${ep(tyBot)}v-${ep(f.dy)}z`;
}

// curvedFlowPathFunction(curvature):
// Returns an SVG-path-producing /function/ based on the given curvature.
// Used for the "d" attribute on a "path" element when curvature > 0.
// Defers to flatFlowPathMaker() when the flow is basically horizontal.
function curvedFlowPathFunction(curvature) {
  return (f) => {
    const syC = f.source.y + f.sy + f.dy / 2, // source flow's y center
      tyC = f.target.y + f.ty + f.dy / 2,     // target flow's y center
      sEnd = f.source.x + f.source.dx,  // source's trailing edge
      tStart = f.target.x;              // target's leading edge

    // Watch out for a nearly-straight path (total rise/fall < 2 pixels OR
    // very little horizontal space to work with).
    // If we have one, make this flow a simple 4-sided shape instead of
    // a curve. (This avoids weird artifacts in some SVG renderers.)
    if (Math.abs(syC - tyC) < 2 || Math.abs(tStart - sEnd) < 12) {
      return flatFlowPathMaker(f);
    }

    f.renderAs = 'curved'; // Render this path as a curved stroke

    // Make the curved path:
    // Set up a function for interpolating between the two x values:
    const xinterpolate = d3.interpolateNumber(sEnd, tStart),
      // Pick 2 curve control points given the curvature & its converse:
      xcp1 = xinterpolate(curvature),
      xcp2 = xinterpolate(1 - curvature);
    // This SVG Path spec means:
    // [M]ove to the center of the flow's start [sx,syC]
    // Draw a Bezier [C]urve using control points [xcp1,syC] & [xcp2,tyC]
    // End at the center of the flow's target [tx,tyC]
    return (
      `M${ep(sEnd)} ${ep(syC)}C${ep(xcp1)} ${ep(syC)} `
        + `${ep(xcp2)} ${ep(tyC)} ${ep(tStart)} ${ep(tyC)}`
    );
  };
}

// renderExportableOutputs: Called directly from the page (and from below).
// Kick off a re-render of the static image and the user-copyable SVG code.
// Used after each draw & when the user chooses a new PNG resolution.
glob.renderExportableOutputs = () => {
  // Reset the existing export output areas:
  const curDate = new Date(),
    pngLinkEl = el('download_png_link');
  // Clear out the old image link, cue user that the graphic isn't yet ready:
  pngLinkEl.textContent = '...creating downloadable graphic...';
  pngLinkEl.setAttribute('href', '#');

  // Wipe out the SVG from the old diagram:
  el('svg_for_export').textContent = '(generating SVG code...)';

  // Fire off asynchronous events for generating the export output,
  // so we can give control back asap:
  setTimeout(render_png(curDate), 0);
  setTimeout(produce_svg_code(curDate), 0);

  return null;
};

// hideReplaceGraphWarning: Called directly from the page (and from below)
// Dismiss the note about overwriting the user's current inputs.
glob.hideReplaceGraphWarning = () => {
  // Hide the overwrite-warning paragraph (if it's showing)
  el('replace_graph_warning').style.display = 'none';
  return null;
};

// replaceGraphConfirmed: Called directly from the page (and from below).
// It's ok to overwrite the user's inputs now. Let's go.
// (Note: In order to reach this code, we have to have already verified the
// presence of the named recipe, so we don't re-verify.)
glob.replaceGraphConfirmed = () => {
  const graphName = elV('demo_graph_chosen'),
    savedRecipe = sampleDiagramRecipes.get(graphName);

  // Update any settings which accompany the stored diagram:
  Object.entries(savedRecipe.settings).forEach(([fld, newVal]) => {
    if (typeof newVal === 'boolean') { // boolean => radio or checkbox
      el(fld).checked = newVal;
    } else { // non-boolean => an ordinary value to set
      el(fld).value = newVal;
    }
  });

  // First, verify that the flow input field is visible.
  // (If it's been hidden, the setting of flows won't work properly.)
  const flowsPanel = 'input_options';
  if (el(flowsPanel).style.display === 'none') {
    glob.togglePanel(flowsPanel);
  }

  // Then select all the existing input text...
  const flowsEl = el('flows_in');
  flowsEl.focus();
  flowsEl.select();
  // ... then replace it with the new content.
  flowsEl.setRangeText(savedRecipe.flows, 0, flowsEl.selectionEnd, 'start');

  // Un-focus the input field (on tablets, this keeps the keyboard from
  // auto-popping-up):
  flowsEl.blur();

  // If the replace-graph warning is showing, hide it:
  glob.hideReplaceGraphWarning();

  // Take away any remembered moves (just in case any share a name with a
  // node in the new diagram) & immediately draw the new diagram::
  glob.resetMovesAndRender();
  return null;
};

// replaceGraph: Called directly from the page.
// User clicked a button which may cause their work to be erased.
// Run some checks before we commit...
glob.replaceGraph = (graphName) => {
  // Is there a recipe with the given key? If not, exit early:
  const savedRecipe = sampleDiagramRecipes.get(graphName);
  if (!savedRecipe) {
    // (This shouldn't happen unless the user is messing around in the DOM)
    console.log(`Requested sample diagram ${graphName} not found.`);
    return null;
  }

  // Set the 'demo_graph_chosen' value according to the user's click:
  el('demo_graph_chosen').value = graphName;

  // When it's easy to revert to the user's current set of inputs, we don't
  // bother asking to confirm. This happens in two scenarios:
  // 1) the inputs are empty, or
  // 2) the user is looking at inputs which exactly match any of the sample
  // diagrams.
  const userInputs = elV('flows_in'),
    inputsMatchAnySample = Array.from(sampleDiagramRecipes.values())
      .some((r) => r.flows === userInputs);

  if (inputsMatchAnySample || userInputs === '') {
    // The user has NOT changed the input from one of the samples,
    // or the whole field is blank. Go ahead with the change:
    glob.replaceGraphConfirmed();
  } else {
    // Show the warning and do NOT replace the graph:
    el('replace_graph_warning').style.display = '';
    el('replace_graph_yes').textContent
      = `Yes, replace the graph with '${savedRecipe.name}'`;
  }

  return null;
};

// colorThemes: The available color arrays to assign to Nodes.
const colorThemes = new Map([
  ['a', {
    colorset: d3.schemeCategory10,
    nickname: 'Categories',
    d3Name: 'Category10',
  }],
  ['b', {
    colorset: d3.schemeTableau10,
    nickname: 'Tableau10',
    d3Name: 'Tableau10',
  }],
  ['c', {
    colorset: d3.schemeDark2,
    nickname: 'Dark',
    d3Name: 'Dark2',
  }],
  ['d', {
    colorset: d3.schemeSet3,
    nickname: 'Varied',
    d3Name: 'Set3',
  }],
]);

function approvedColorTheme(themeKey) {
  // Give back an empty theme if the key isn't valid:
  return colorThemes.get(themeKey.toLowerCase())
    || { colorset: [], nickname: 'Invalid Theme', d3Name: '?' };
}

// rotateColors: Return a copy of a color array, rotated by the offset:
function rotateColors(colors, offset) {
  const goodOffset = clamp(offset, 0, colors.length);
  return colors.slice(goodOffset).concat(colors.slice(0, goodOffset));
}

// nudgeColorTheme: Called directly from the page.
// User just clicked an arrow on a color theme.
// Rotate the theme colors & re-display the diagram with the new set.
glob.nudgeColorTheme = (themeKey, move) => {
  const themeOffsetEl = el(`theme_${themeKey}_offset`),
    currentOffset = (themeOffsetEl === null) ? 0 : themeOffsetEl.value,
    colorsInTheme = approvedColorTheme(themeKey).colorset.length,
    newOffset = (colorsInTheme + +currentOffset + +move) % colorsInTheme;

  // Update the stored offset with the new value (0 .. last color):
  themeOffsetEl.value = newOffset;

  // If the theme the user is updating is not the active one, switch to it:
  el(`theme_${themeKey}_radio`).checked = true;

  glob.process_sankey();
  return null;
};

// render_sankey: given nodes, flows, and other config, MAKE THE SVG DIAGRAM:
function render_sankey(allNodes, allFlows, cfg) {
  // Set up functions and measurements we will need:

  // withUnits: Format a value with the current style.
  function withUnits(n) { return formatUserData(n, cfg.numberStyle); }

  // To measure text sizes, first we make a dummy SVG area the user won't
  // see, with the same size and font details as the real diagram:
  const scratchRoot = d3.select('#svg_scratch')
    .attr('height', cfg.canvas_height)
    .attr('width', cfg.canvas_width)
    .attr('text-anchor', 'middle')
    .attr('opacity', '0') // Keep all this invisible...
    .attr('font-family', cfg.font_face)
    .attr('font-size', `${cfg.font_size}px`)
    .attr('font-weight', cfg.font_weight);
  scratchRoot.selectAll('*').remove(); // Clear out any past items

  // measureText(string, id):
  //   Measure an SVG text element, placed at the hidden canvas' midpoint
  function measureText(txt, id) {
    const txtId = `bb_${id}`, // (bb for 'BoundingBox')
      txtElement = scratchRoot
        .append('text')
        .attr('id', txtId)
        .attr('x', cfg.canvas_width / 2)
        .attr('y', cfg.canvas_height / 2)
        .text(txt),
      bb = txtElement.node().getBBox();
    return { w: bb.width, h: bb.height };
  }

  // setUpTextDimensions():
  //   Compute padding values for label highlights, etc.
  function setUpTextDimensions() {
    // isFirefox(): checks for Firefox-ness of the browser.
    // Why? Because we have to adjust SVG font spacing for Firefox's
    // sake.
    // It would be better if SVG-font-sizing differences were detectable
    // directly, but so far I haven't figured out how to test for just
    // that, so we check for Firefox. (Many use 'InstallTrigger' to
    // check for FF, but that's been deprecated.)
    function isFirefox() {
      return navigator
        && /firefox/i.test(
          navigator.userAgent || navigator.vendor || ''
        );
    }

    // First, how big are an em and an ex in the current font, roughly?
    const emSize = measureText('m', 'em'),
      boundingBoxH = emSize.h, // (same for all characters)
      emW = emSize.w,
      // The WIDTH of an 'x' is a crude estimate of the x-HEIGHT, but
      // it's what we have for now:
      exH = measureText('x', 'ex').w,
      // Firefox has unique SVG measurements in 2022, so we look for it:
      browserKey = isFirefox() ? 'firefox' : '*',
      metrics
        = fontMetrics[browserKey][cfg.font_face]
          || fontMetrics[browserKey]['*'],
      m = {
        dy: metrics.dy * boundingBoxH,
        top: metrics.top * exH,
        bot: metrics.bot * exH,
        inner: metrics.inner * emW,
        outer: metrics.outer * emW,
        };
    // Compute the remaining values (which depend on values above).
    // lblMarginRight = total margin to give a label when it is to the right
    //   of a node. (Note: this value basically includes m.inner)
    // lblMarginLeft = total margin when label is to the left
    m.lblMarginRight
      = (cfg.node_border / 2)
        + metrics.marginRight * m.inner;
    m.lblMarginLeft
      = (cfg.node_border / 2)
        + (metrics.marginRight + metrics.marginAdjLeft) * m.inner;
    return m;
  }

  const pad = setUpTextDimensions(),
    // Create the sankey object & the properties needed for the skeleton.
    // NOTE: The call to d3.sankey().setup() will MODIFY the allNodes and
    // allFlows objects -- filling in specifics about connections, stages,
    // etc.
    sankeyObj = d3.sankey()
      .nodes(allNodes)
      .flows(allFlows)
      .rightJustifyEndpoints(cfg.justify_ends)
      .leftJustifyOrigins(cfg.justify_origins)
      .setup();

  // After the .setup() step, Nodes are divided up into Stages.
  // stagesArr = each Stage in the diagram (and the Nodes inside them)
  let stagesArr = sankeyObj.stages();

  // MARK Label-measuring time
  // Depending on where labels are meant to be placed, we measure their
  // sizes and calculate how much room has to be reserved for them (and
  // subtracted from the graph area):

  // shadowFilter(i): true/false value indicating whether to display an item.
  // Normally shadows are hidden, but the reveal_shadows flag can override.
  // i can be either a node or a flow.
  function shadowFilter(i) { return !i.isAShadow || cfg.reveal_shadows; }

  if (cfg.show_labels) {
    // Set up 'labelText' for all the Nodes. (This is done earlier than
    // it used to be, but we need to know now for the sake of layout):
    allNodes.filter(shadowFilter)
      .forEach((n) => {
      n.labelText
        = cfg.include_values_in_node_labels
          ? `${n.name}: ${withUnits(n.value)}` : n.name;
    });
  }

  // maxLabelWidth(stageArr, labelsOnLeft):
  //   Compute the total space required by the widest label in a stage
  function maxLabelWidth(stageArr, labelsOnLeft) {
    let maxWidth = 0;
    stageArr.filter((n) => n.labelText)
      .forEach((n) => {
        const labelW
          = measureText(n.labelText, n.dom_id).w
            + (labelsOnLeft
            ? pad.lblMarginLeft
            : pad.lblMarginRight)
            + pad.outer;
        maxWidth = Math.max(maxWidth, labelW);
      });
    return maxWidth;
  }

  // setUpDiagramSize(): Compute the final size of the graph
  function setUpDiagramSize() {
    // Calculate the actual room we have to draw in...
    // Start from the user's declared canvas size + margins:
    const graphW = cfg.canvas_width - cfg.left_margin - cfg.right_margin,
      graphH = cfg.canvas_height - cfg.top_margin - cfg.bottom_margin,
      // If any labels are on the LEFT, get stage[0]'s maxLabelWidth:
      leadingW
        = ['before', 'outside'].includes(cfg.label_pos)
          ? maxLabelWidth(stagesArr[0], true)
          : cfg.node_border / 2,
      // If any are on the RIGHT, get stage[-1]'s maxLabelWidth:
      trailingW
        = ['after', 'outside'].includes(cfg.label_pos)
          ? maxLabelWidth(stagesArr[stagesArr.length - 1], false)
          : cfg.node_border / 2,
      // Compute the ideal width to fit everything successfully:
      idealW = graphW - leadingW - trailingW,
      // Find the smallest width we will allow -- all the Node widths
      // plus (5px + node_border) for every Flow region:
      minimumW
        = (stagesArr.length * cfg.node_width)
          + ((stagesArr.length - 1) * (cfg.node_border + 5)),
      // Pick which width we will actually use:
      finalW = Math.max(idealW, minimumW),
      // Is any part of the diagram going to be cut off?
      // If so, we have to decide how to distribute the bad news.
      //
      // This derives the proportion of any potential cut-off area
      // which shall be attributed to the leading side:
      leadingShareOfError
        = leadingW + trailingW > 0
          ? (leadingW / (leadingW + trailingW))
          : 0.5,
      // The actual amount of error (if any) for the leading side:
      leadingCutOffAdjustment
        = idealW < minimumW
          ? (idealW - minimumW) * leadingShareOfError
          : 0,
      // Compute the left margin we will actually use:
      finalLeftMargin
        = cfg.left_margin + leadingW + leadingCutOffAdjustment;
    return { w: finalW, h: graphH, leftMargin: finalLeftMargin };
  }

  const graph = setUpDiagramSize();

  // Ready for final layout!
  // We have the skeleton set up; add the remaining dimension values.
  // (Note: This call further alters allNodes & allFlows with their
  // specific coordinates.)
  sankeyObj.size({ w: graph.w, h: graph.h })
    .nodeWidth(cfg.node_width)
    .nodeHeightFactor(cfg.node_height / 100)
    .nodeSpacingFactor(cfg.node_spacing / 100)
    .autoLayout(cfg.auto_layout)
    .layout(cfg.iterations); // Note: The 'layout()' step must be LAST

  // We *update* the final stages array here, because in theory it may
  // have been changed. The final array will be used for some layout
  // questions (like where labels will land inside the diagram, or for
  // the 'outside-in' flow color style):
  stagesArr = sankeyObj.stages();

  // Now that the stages & values are known, we can finish preparing the
  // Node & Flow objects for the SVG-rendering routine.

  const userColorArray = cfg.default_node_colorset === 'none'
      // User wants a color array with just the one value:
      ? [cfg.default_node_color]
      : rotateColors(
        approvedColorTheme(cfg.default_node_colorset).colorset,
        cfg.selected_theme_offset
        ),
    colorScaleFn = d3.scaleOrdinal(userColorArray),
    // Drawing curves with curvature of <= 0.1 looks bad and produces visual
    // artifacts, so let's just take the lowest value on the slider (0.1)
    // and use that value to mean 0/flat:
    flowsAreFlat = (cfg.curvature <= 0.1),
    // flowPathFn is a function producing an SVG path; the same function is
    // used for all Flows. (Flat flows use a simpler function.)
    flowPathFn = flowsAreFlat
      ? flatFlowPathMaker
      : curvedFlowPathFunction(cfg.curvature),
    // Is the diagram background dark or light?
    darkBg = (cfg.background_color.toUpperCase() < '#888'),
    // Is the label color more like black or like white?
    darkLabel = (cfg.font_color.toUpperCase() < '#AAA'),
    // Set up label highlight values:
    hlStyle = highlightStyles[darkLabel ? 'dark' : 'light'];
    hlStyle.orig.fill_opacity = Number(cfg.label_highlight);
    // Given the user's opacity, calculate a reasonable hover
    // value (2/3 of the distance to 1):
    hlStyle.hover.fill_opacity = 0.666 + Number(cfg.label_highlight) / 3;

  // stagesMidpoint: Helpful value for deciding if something is in the first
  // or last half of the diagram:
  function stagesMidpoint() { return (stagesArr.length - 1) / 2; }

  // Fill in presentation values for each Node (so the render routine
  // doesn't have to do any thinking):
  allNodes.filter(shadowFilter)
    .forEach((n) => {
    n.dom_id = `r${n.index}`; // r0, r1... ('r' = '<rect>')
    // Everything with this class value will move with the Node when it is
    // dragged:
    n.css_class = `for_${n.dom_id}`; // for_r0, for_r1...
    n.tooltip = `${n.name}:\n${withUnits(n.value)}`;
    n.opacity = n.opacity || cfg.default_node_opacity;

    // Fill in any missing Node colors. (Flows may inherit from these.)
    if (typeof n.color === 'undefined' || n.color === '') {
      // Use the first non-blank portion of a label as the basis for
      // adopting an already-used color or picking a new one.
      // (Note: this is case sensitive!)
      // If there are no non-blank strings in the node name, substitute
      // a word-ish value (rather than crash):
      const firstBlock
        = (/^\s*(\S+)/.exec(n.name) || ['', 'name-is-blank'])[1];
      // Don't use up colors on shadow nodes:
      n.color = n.isAShadow ? '#999' : colorScaleFn(firstBlock);
    }
    // Now that we're guaranteed a color, we can calculate the border shade:
    n.border_color
      = darkBg ? d3.rgb(n.color).brighter(2) : d3.rgb(n.color).darker(2);

    // Set up label presentation values:
    if (cfg.show_labels) {
      // Which side of the node will the label be on?
      let leftLabel = true;
      switch (cfg.label_pos) {
        case 'before': break;
        case 'after': leftLabel = false; break;
        // 'outside': Nodes in the FIRST half of all stages put their
        // labels on the left:
        case 'outside': leftLabel = n.stage <= stagesMidpoint(); break;
        // 'inside': Nodes are positioned at the diagram's outer
        // edge, with labels toward the center. (This results in
        // label/node-matching confusion sometimes.)
        // So Nodes in the LAST half of all stages put their labels
        // on the left:
        case 'inside': leftLabel = n.stage >= stagesMidpoint();
        // no default
      }

      n.label = {
        dom_id: `label${n.index}`, // label0, label1..
        anchor: leftLabel ? 'end' : 'start',
        x: leftLabel
          ? n.x - pad.lblMarginLeft
          : n.x + n.dx + pad.lblMarginRight,
        y: n.y + n.dy / 2,
        dy: pad.dy,
      };
      // Will there be any highlights? If not, n.label.bg will be null:
      if (hlStyle.orig.fill_opacity > 0) {
        n.label.bg = {
          dom_id: `${n.label.dom_id}_bg`, // label0_bg, label1_bg..
          offset: {
            x: leftLabel ? -pad.outer : -pad.inner,
            y: -pad.top,
            w: pad.inner + pad.outer,
            h: pad.top + pad.bot,
          },
          ...hlStyle.orig,
        };
      }
    }
  });

  // ...and fill in more Flow details as well:
  allFlows.filter(shadowFilter)
    .forEach((f) => {
    f.dom_id = `flow${f.index}`; // flow0, flow1...
    f.tooltip
      = `${f.source.name} → ${f.target.name}: ${withUnits(f.value)}`;
    // Fill in any missing opacity values and the 'hover' counterparts:
    f.opacity = f.opacity || cfg.default_flow_opacity;
    // Hover opacity = halfway between the user's opacity and 1.0:
    f.opacity_on_hover = 0.5 + Number(f.opacity) / 2;

    // Derive any missing Flow colors.
    if (f.color === '') {
      // Stroke Color priority order:
      // 0. If it's a shadow, just color it gray.
      // 1. color given directly to the flow (filtered out above)
      // 2. inheritance-from-node-with-specific-paint-direction
      // 3. default-inheritance-direction OR default flow color
      if (f.isAShadow) {
        f.color = '#999';
      } else if (f.source.paint[AFTER]) {
        f.color = f.source.color;
      } else if (f.target.paint[BEFORE]) {
        f.color = f.target.color;
      } else {
        const flowMidpoint = (f.source.stage + f.target.stage) / 2;
        switch (cfg.default_flow_inherit) {
          case 'source': f.color = f.source.color; break;
          case 'target': f.color = f.target.color; break;
          case 'outside_in':
            // Is the flow's midpoint in the right half, or left?
            // (In the exact middle, we use the source color.)
            f.color = flowMidpoint <= stagesMidpoint()
              ? f.source.color
              : f.target.color;
            break;
          case 'none': f.color = cfg.default_flow_color;
          // no default
        }
      }
    }
    // Set up alternative values to enable the current flow to be
    // rendered as either flat or curved:
    // When a flow is FLAT:
    //  * It's really a parallelogram, so it needs a 'fill' value.
    //  * We still add a stroke because very angled flows can look too
    //  thin otherwise. (They still can, even with the stroke.)
    // When a flow is CURVED:
    //  * No fill; only stroke-width!
    //  * stroke-width is set to at least 1px so tiny flows can be seen.
    f.fill = { flat: f.color, curved: 'none' };
    f.stroke_width = { flat: 0.5, curved: Math.max(1, f.dy) };
  });

  // At this point, allNodes and allFlows are ready to go. Draw!

  // Clear out any old contents & update the size and class:
  initializeDiagram(cfg);

  // Select the svg canvas:
  const diagramRoot = d3.select('#sankey_svg');

  // If a background color is defined, add a backing rectangle with that color:
  if (!cfg.background_transparent) {
    // Note: This just adds the rectangle *without* changing the d3
    // selection stored in diagramRoot:
    diagramRoot.append('rect')
      .attr('height', cfg.canvas_height)
      .attr('width', cfg.canvas_width)
      .attr('fill', cfg.background_color);
  }

  // Add a [g]roup which moves the remaining diagram inward based on the
  // user's margins.
  const diagMain
    = diagramRoot.append('g')
      .attr('transform', `translate(${graph.leftMargin},${cfg.top_margin})`);

  // MARK Functions for Flow hover effects
  // applyFlowEffects(flow, opacity, styles):
  //   Update a flow & its related labels based on the hover state:
  function applyFlowEffects(f, o, s) {
    // Use overall 'opacity' because f might use either a fill or stroke:
    d3.select(`#${f.dom_id}`).attr('opacity', o);
    [f.source, f.target].filter((n) => n.label?.bg)
      .forEach((n) => {
        d3.select(`#${n.label.bg.dom_id}`)
          .attr('fill', s.fill)
          .attr('fill-opacity', ep(s.fill_opacity))
          .attr('stroke', s.stroke)
          .attr('stroke-width', ep(s.stroke_width))
          .attr('stroke-opacity', ep(s.stroke_opacity));
    });
  }

  // Hovering over a flow increases its opacity & highlights the labels of
  // the source+target:
  function turnOnFlowHoverEffects(_, f) {
    f.hovering = true;
    applyFlowEffects(f, f.opacity_on_hover, hlStyle.hover);
  }

  // Leaving a flow restores its original appearance:
  function turnOffFlowHoverEffects(_, f) {
    applyFlowEffects(f, f.opacity, hlStyle.orig);
    // don't clear the flag until the job is done:
    f.hovering = false;
  }

  // Set up the [g]roup of rendered flows:
  // diagFlows = the d3 selection of all flow paths:
  const diagFlows = diagMain.append('g')
      .attr('id', 'sankey_flows')
      .selectAll()
      .data(allFlows.filter(shadowFilter))
      .enter()
      .append('path')
      .attr('id', (f) => f.dom_id)
      .attr('d', flowPathFn) // set the SVG path for each flow
      .attr('fill', (f) => f.fill[f.renderAs])
      .attr('stroke-width', (f) => ep(f.stroke_width[f.renderAs]))
      .attr('stroke', (f) => f.color)
      .attr('opacity', (f) => f.opacity)
      // add emphasis-on-hover behavior:
      .on('mouseover', turnOnFlowHoverEffects)
      .on('mouseout', turnOffFlowHoverEffects)
      // Sort flows to be rendered:
      // first from non-Shadows to Shadows,
      // then from largest to smallest (so if flows cross, the
      // smaller ones are drawn on top):
      .sort((a, b) => a.isAShadow - b.isAShadow || b.dy - a.dy);

  // Add a tooltip for each flow:
  diagFlows.append('title').text((f) => f.tooltip);

  // MARK Drag functions for Nodes

  // isAZeroMove: simple test of whether every offset is 0 (no move at all):
  function isAZeroMove(a) { return a.every((m) => m === 0); }

  // Given a Node index, apply its move to the SVG & remember it for later:
  function applyNodeMove(index) {
    const n = allNodes[index],
      graphIsReversed = el('reverse_graph').checked,
      // In the case of a reversed graph, we negate the x-move:
      myXMove = n.move[0] * (graphIsReversed ? -1 : 1),
      availableW = graph.w - n.dx,
      availableH = graph.h - n.dy;

    // Apply the move to the node (halting at the edges of the graph):
    n.x = Math.max(
      0,
      Math.min(availableW, n.origPos.x + availableW * myXMove)
      );
    n.y = Math.max(
      0,
      Math.min(availableH, n.origPos.y + availableH * n.move[1])
      );

    // Find everything which shares the class of the dragged Node and
    // translate all of them with these offsets.
    // Currently this means the Node and the label+highlight, if present.
    // (Why would we apply a null transform? Because it may have been
    // transformed already & we are now undoing the previous operation.)
    d3.selectAll(`#sankey_svg .${n.css_class}`)
      .attr('transform', isAZeroMove(n.move)
        ? null
        : `translate(${ep(n.x - n.origPos.x)},${ep(n.y - n.origPos.y)})`);
  }

  // Set the new starting point of any constrained move:
  function updateLastNodePosition(n) { n.lastPos = { x: n.x, y: n.y }; }

  // rememberNodeMove: Save a move so it can be re-applied.
  // The value saved is the % of the available size that the node was moved,
  // not the literal pixel move. This helps when the user is changing
  // spacing or diagram size.
  function rememberNodeMove(n) {
    // Always update lastPos when remembering moves:
    updateLastNodePosition(n);
    if (isAZeroMove(n.move)) {
      // There's no actual move now. If one was stored, forget it:
      glob.rememberedMoves.delete(n.name);
    } else {
      // We save moves keyed to their NAME (not their index), so they
      // can be remembered even when the inputs change their order.
      //
      // In the case of a move already remembered, this will replace the
      // original moves with an identical copy...seems less trouble than
      // checking first.
      glob.rememberedMoves.set(n.name, n.move);
    }
    // The count of rememberedMoves may have changed, so also update the UI:
    updateResetNodesUI();
  }

  // After one or more Node moves are done, call this:
  function reLayoutDiagram() {
    // Recalculate all flow positions given new node position(s):
    sankeyObj.relayout();

    // For every flow, update its 'd' path attribute with the new
    // calculated path.
    diagFlows.attr('d', flowPathFn)
      // (This may *also* change how the flow must be rendered,
      // so derive those attributes again:)
      .attr('fill', (f) => f.fill[f.renderAs])
      .attr('stroke-width', (f) => ep(f.stroke_width[f.renderAs]));

    // Regenerate the exportable versions:
    glob.renderExportableOutputs();
  }

  // Show helpful guides/content for the current drag. We put it all in a
  // distinct 'g'roup for helper content so we can remove it easily later:
  function dragNodeStarted(event, n) {
    const grayColor = contrasting_gray_color(cfg.background_color);
    let diagHelperLayer = diagMain.select('#helper_layer');
    // Create the helper layer if it doesn't exist:
    if (!diagHelperLayer.nodes.length) {
      // Insert it just before (i.e. 'under') the 'nodes' layer, so it
      // doesn't interfere with things like double-clicks on nodes.
      diagHelperLayer = diagMain.insert('g', '#sankey_nodes')
        .attr('id', 'helper_layer')
        // Set up attributes common to all the stuff inside here..
        .attr('fill', grayColor)
        .attr('fill-opacity', 0.5)
        .attr('stroke', 'none');
    }

    // Draw 4 horizontal/vertical guide lines, along the edges of the
    // place where the drag began (d.lastPos):
    diagHelperLayer.append('path')
      .attr('id', 'helper_lines')
      // This SVG Path spec means:
      // [M]ove to the left edge of the graph at this node's top
      // [h]orizontal line across the whole graph width
      // [m]ove down by this node's height
      // [H]orizontal line back to the left edge (x=0)
      // ..Then the same operation [v]ertically, using this node's width.
      .attr('d', `M0 ${ep(n.lastPos.y)} h${ep(graph.w)} m0 ${ep(n.dy)} H0`
           + `M${ep(n.lastPos.x)} 0 v${ep(graph.h)} m${ep(n.dx)} 0 V0`)
      .attr('stroke', grayColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '1 3')
      .attr('stroke-opacity', 0.7);

    // Put a ghost rectangle where this node started out:
    diagHelperLayer.append('rect')
      .attr('id', 'helper_original_rect')
      .attr('x', ep(n.origPos.x))
      .attr('y', ep(n.origPos.y))
      .attr('height', ep(n.dy))
      .attr('width', ep(n.dx))
      .attr('fill', n.color)
      .attr('fill-opacity', 0.3);

    // Check for the Shift key. If it's down when starting the drag, skip
    // the hint:
    if (!(event.sourceEvent && event.sourceEvent.shiftKey)) {
      // Place hint text where it can hopefully be seen,
      // in a [g]roup which can be removed later during dragging:
      const shiftHints = diagHelperLayer.append('g')
          .attr('id', 'helper_shift_hints')
          .attr('font-size', '14px')
          .attr('font-weight', '400'),
        hintHeights = graph.h > 350 ? [0.05, 0.95] : [0.4];
      // Show the text so it's visible but not overwhelming:
      hintHeights.forEach((h) => {
        shiftHints.append('text')
          .attr('text-anchor', 'middle')
          .attr('x', graph.w / 2)
          .attr('y', graph.h * h)
         .text('Hold down Shift to move in only one direction');
      });
    }
    return null;
  }

  // This is called _during_ Node drags:
  function draggingNode(event, n) {
    // Fun fact: In this context, event.subject is the same thing as 'd'.
    let myX = event.x,
      myY = event.y;
    const graphIsReversed = el('reverse_graph').checked;

    // Check for the Shift key:
    if (event.sourceEvent && event.sourceEvent.shiftKey) {
      // Shift is pressed, so this is a constrained drag.
      // Figure out which direction the user has dragged _further_ in:
      if (Math.abs(myX - n.lastPos.x) > Math.abs(myY - n.lastPos.y)) {
        myY = n.lastPos.y; // Use X move; keep Y constant
      } else {
        myX = n.lastPos.x; // Use Y move; keep X constant
      }
      // If they've Shift-dragged, they don't need the hint any more -
      // remove it and don't bring it back until the next gesture.
      const shiftHint = diagMain.select('#helper_shift_hints');
      if (shiftHint.nodes) { shiftHint.remove(); }
    }

    // Calculate the percentages we want to save (which will stay
    // independent of the graph's edge constraints, even if the spacing,
    // etc. changes to distort them):
    n.move = [
      // If the graph is RTL, calculate the x-move as though it is LTR:
      (graphIsReversed ? -1 : 1) * ((myX - n.origPos.x) / (graph.w - n.dx)),
      (graph.h === n.dy) ? 0 : (myY - n.origPos.y) / (graph.h - n.dy),
    ];

    applyNodeMove(n.index);
    // Note: We DON'T rememberNodeMove after every pixel-move of a drag;
    // just when a gesture is finished.
    reLayoutDiagram();
    return null;
  }

  // (Investigate: This is called on every ordinary *click* as well; look
  // into skipping this work if no actual move has happened.)
  function dragNodeEnded(event, n) {
    // Take away the helper guides:
    const helperLayer = diagMain.select('#helper_layer');
    if (helperLayer.nodes) { helperLayer.remove(); }

    // After a drag is finished, any new constrained drag should use the
    // _new_ position as 'home'. Therefore we have to set this as the
    // 'last' position:
    rememberNodeMove(n);

    // Sometimes the pointer has ALSO been over a flow, which means
    // that any flow & its labels could be highlighted in the produced
    // SVG and PNG - which is not what we want.
    // Therefore, at the end of any drag, turn *off* any lingering
    // hover-effects before we render the PNG+SVG:
    allFlows.filter((f) => f.hovering)
      .forEach((f) => { turnOffFlowHoverEffects(null, f); });

    reLayoutDiagram();
    return null;
  }

  // A double-click resets a node to its default rendered position:
  function doubleClickNode(event, n) {
    n.move = [0, 0];
    applyNodeMove(n.index);
    rememberNodeMove(n);
    reLayoutDiagram();
    return null;
  }

  // Set up the <g>roup of Nodes, including drag behavior:
  const diagNodes = diagMain.append('g')
    .attr('id', 'sankey_nodes')
    .selectAll('.node')
    .data(allNodes.filter(shadowFilter))
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragNodeStarted)
      .on('drag', draggingNode)
      .on('end', dragNodeEnded))
    .on('dblclick', doubleClickNode);

  // Set up Node borders, if specified:
  if (cfg.node_border) {
    diagNodes.append('rect')
      .attr('id', (n) => `${n.dom_id}_border`)
      .attr('class', (n) => n.css_class)
      .attr('x', (n) => ep(n.x))
      .attr('y', (n) => ep(n.y))
      .attr('height', (n) => ep(n.dy))
      .attr('width', (n) => ep(n.dx))
      .attr('stroke', (n) => n.border_color)
      .attr('stroke-width', cfg.node_border)
      .attr('fill', 'none');
  }

  // Construct the main <rect>angles for NODEs:
  diagNodes.append('rect')
    // Give a unique ID & class to each rect that we can reference:
    .attr('id', (n) => n.dom_id)
    .attr('class', (n) => n.css_class)
    .attr('x', (n) => ep(n.x))
    .attr('y', (n) => ep(n.y))
    .attr('height', (n) => ep(n.dy))
    .attr('width', (n) => ep(n.dx))
    // we made sure above there will be a color defined:
    .attr('fill', (n) => n.color)
    .attr('fill-opacity', (n) => n.opacity)
    // Add tooltips showing node totals:
    .append('title')
    .text((n) => n.tooltip);

  // Create a top layer for labels & highlights, so nodes can't block them:
  const diagLabels = diagMain.append('g')
    .attr('id', 'sankey_labels')
    // These font spec defaults apply to all labels within
    .attr('font-family', cfg.font_face)
    .attr('font-size', `${cfg.font_size}px`)
    .attr('font-weight', cfg.font_weight)
    .attr('fill', cfg.font_color);
  if (cfg.mention_sankeymatic) {
    diagLabels.append('text')
      // Anchor the text to the midpoint of the canvas (not the graph):
      .attr('text-anchor', 'middle')
      // x = graphW/2 is wrong when the L/R margins are uneven.. We
      // have to use the whole width & adjust for the graph's transform:
      .attr('x', cfg.canvas_width / 2 - graph.leftMargin)
      .attr('y', graph.h + cfg.bottom_margin - 5)
      // Keep the current font, but make this small & grey:
      .attr('font-size', '11px')
      .attr('font-weight', '400')
      .attr('fill', contrasting_gray_color(cfg.background_color))
      .text('Made with SankeyMATIC');
  }

  if (cfg.show_labels) {
    // Add labels in a distinct layer on the top (so nodes can't block them)
    diagLabels.selectAll()
      .data(allNodes.filter(shadowFilter))
      .enter()
      .append('text')
      .attr('id', (n) => n.label.dom_id)
      // Associate this label with its Node using the CSS class:
      .attr('class', (n) => n.css_class)
      .attr('text-anchor', (n) => n.label.anchor)
      .attr('x', (n) => ep(n.label.x))
      .attr('y', (n) => ep(n.label.y))
      // Nudge letters down to be vertically centered:
      .attr('dy', (n) => n.label.dy)
      .text((n) => n.labelText);

    // For any nodes with a label highlight defined, render it:
    allNodes.filter(shadowFilter)
      .filter((n) => n.label.bg)
      .forEach((n) => {
      // Use each label's size to make custom round-rects underneath:
      const labelTextSelector = `#${n.label.dom_id}`,
        labelBB
          = diagLabels.select(labelTextSelector).node().getBBox(),
        bg = n.label.bg;
      // Put the highlight rectangle just before each text:
      diagLabels.insert('rect', labelTextSelector)
        .attr('id', bg.dom_id)
        // Make sure a Node drag will affect this as well:
        .attr('class', n.css_class)
        .attr('x', ep(labelBB.x + bg.offset.x))
        .attr('y', ep(labelBB.y + bg.offset.y))
        .attr('width', ep(labelBB.width + bg.offset.w))
        .attr('height', ep(labelBB.height + bg.offset.h))
        .attr('rx', ep(cfg.font_size / 4))
        .attr('fill', bg.fill)
        .attr('fill-opacity', ep(bg.fill_opacity))
        .attr('stroke', bg.stroke)
        .attr('stroke-width', ep(bg.stroke_width))
        .attr('stroke-opacity', ep(bg.stroke_opacity));
    });
  }

  // Now that all of the SVG nodes and labels exist, it's time to re-apply
  // any remembered moves:
  if (glob.rememberedMoves.size) {
    // Make a copy of the list of moved-Node names (so we can destroy it):
    const movedNodes = new Set(glob.rememberedMoves.keys());

    // Look for all node objects matching a name in the list:
    allNodes.filter(shadowFilter)
      .filter((n) => movedNodes.has(n.name))
      .forEach((n) => {
        n.move = glob.rememberedMoves.get(n.name);
        // Make this move visible in the diagram:
        applyNodeMove(n.index);
        updateLastNodePosition(n);
        // DON'T 'rememberNodeMove' here - if we do, then the last
        // manual move will be unintentionally modified when only the
        // spacing was changed, for example.

        // Delete this moved node's name from the Set:
        movedNodes.delete(n.name);
      });
    // Any remaining items in movedNodes must refer to Nodes which are no
    // longer with us. Delete those from the global memory:
    movedNodes.forEach((nodeName) => {
      glob.rememberedMoves.delete(nodeName);
    });

    // Re-layout the diagram once, after all of the above moves:
    reLayoutDiagram();
  }
} // end of render_sankey

// MAIN FUNCTION:
// process_sankey: Called directly from the page and within this script.
// Gather inputs from user; validate them; render updated diagram
glob.process_sankey = () => {
  let maxDecimalPlaces = 0,
    totalInflow = 0,
    totalOutflow = 0,
    statusMsg = '',
    maxNodeIndex = 0,
    maxNodeVal = 0;
  const invalidLines = [],
    uniqueNodes = new Map(),
    approvedNodes = [],
    goodFlows = [],
    approvedFlows = [],
    differences = [],
    differencesEl = el('imbalances'),
    listDifferencesEl = el('flow_cross_check'),
    chartEl = el('chart'),
    messagesEl = el('top_messages_container'),
    graphIsReversed = el('reverse_graph').checked;

  // addMsgAbove: Put a message above the chart using the given class:
  function addMsgAbove(msgHTML, msgClass, msgGoesFirst) {
    const newMsg = `<div class="${msgClass}">${msgHTML}</div>`;
    messagesEl.innerHTML = msgGoesFirst
      ? (newMsg + messagesEl.innerHTML)
      : (messagesEl.innerHTML + newMsg);
  }

  function setTotalsMsg(msgHTML) {
    el('messages_container').innerHTML = `<div>${msgHTML}</div>`;
  }

  function setDifferencesMsg(msgHTML) {
    el('imbalance_messages').innerHTML
      = msgHTML.length ? `<div id="imbalance_msg">${msgHTML}</div>` : '';
  }

  // Update the display of all known themes given their offsets:
  function updateColorThemeDisplay() {
    // template string for the color swatches:
    const makeSpanTag = (color, count, themeName) => (
      `<span style="background-color: ${color};" `
      + `class="color_sample_${count}" `
      + `title="${color} from d3 color scheme ${themeName}">`
      + '&nbsp;</span>'
    );
    for (const t of colorThemes.keys()) {
      const theme = approvedColorTheme(t),
        themeOffset = elV(`theme_${t}_offset`),
        colorset = rotateColors(theme.colorset, themeOffset),
        // Show the array rotated properly given the offset:
        renderedGuide = colorset
          .map((c) => makeSpanTag(c, colorset.length, theme.d3Name))
          .join('');
        // SOMEDAY: Add an indicator for which colors are/are not
        // in use?
      el(`theme_${t}_guide`).innerHTML = renderedGuide;
      el(`theme_${t}_label`).textContent = theme.nickname;
    }
  }

  // BEGIN by resetting all messages:
  messagesEl.textContent = '';

  // Go through lots of validation with plenty of bailout points and
  // informative messages for the poor soul trying to do this.

  // Checking the 'Transparent' background-color box *no longer* means that
  // the color-picker is pointless; it still affects the color value which
  // will be given to "Made with SankeyMATIC".
  // Therefore, we no longer disable the Background Color element, even when
  // 'Transparent' is checked.

  // Flows validation:

  // addNodeName: Make sure a node's name is present in the 'unique' list
  // with the lowest row number the node has appeared on:
  function addNodeName(nodeName, row) {
    // Have we seen this node before? Then all we need to do is check
    // if the new row # should replace the stored row #:
    if (uniqueNodes.has(nodeName)) {
      const thisNode = uniqueNodes.get(nodeName);
      if (thisNode.sourceRow > row) { thisNode.sourceRow = row; }
    } else {
      // Set up the node's raw object, keyed to the name:
      uniqueNodes.set(nodeName, {
        name: nodeName,
        sourceRow: row,
        paintInputs: [],
      });
    }
  }

  // updateNodeAttrs: Update an existing node's attributes.
  // Note: If there are multiple lines specifying a value for the same
  // parameter for a node, the LAST declaration will win.
  function updateNodeAttrs(nodeParams) {
    // Just in case this is the first appearance of the name (or we've
    // encountered an earlier row than the node declaration), add it to
    // the big list:
    addNodeName(nodeParams.name, nodeParams.sourceRow);
    // We've already used the 'sourceRow' value and don't want it to
    // overwrite anything, so take it out of the params object:
    delete nodeParams.sourceRow;

    // If there's a color and it's a color CODE, put back the #:
    // TODO: honor or translate color names?
    if (nodeParams.color?.match(/[0-9A-F]{3,6}/i)) {
      nodeParams.color = `#${nodeParams.color}`;
    }

    Object.entries(nodeParams).forEach(([pName, pVal]) => {
      if (typeof pVal !== 'undefined'
        && pVal !== null && pVal !== '') {
        uniqueNodes.get(nodeParams.name)[pName] = pVal;
      }
    });
  }

  // Parse inputs into: approvedNodes, approvedFlows, approvedConfig
  // As part of this step, we drop any zero-width spaces which may have
  // been appended or prepended to lines (e.g. when pasted from
  // PowerPoint), then trim again.
  const sourceLines = elV('flows_in')
    .split('\n')
    .map((l) => l.trim()
      .replace(/^\u200B+/, '')
      .replace(/\u200B+$/, '')
      .trim());

  // Loop through all the input lines, storing good ones vs bad ones:
  sourceLines.forEach((lineIn, row) => {
    // Is it a blank line OR a comment? Skip it entirely.
    // Currently comments can start with ' or //:
    if (lineIn === '' || /^(?:'|\/\/)/.test(lineIn)) {
      return;
    }

    // Does this line look like a Node?
    let matches = lineIn.match(
      /^:(.+) #([0-9A-F]{0,6})?(\.\d{1,4})?\s*(>>|<<)*\s*(>>|<<)*$/i
    );
    if (matches !== null) {
      // Save/update it in the uniqueNodes structure:
      updateNodeAttrs({
        name: matches[1].trim(),
        color: matches[2],
        opacity: matches[3],
        paintInputs: [matches[4], matches[5]],
        sourceRow: row,
      });
      // No need to process this as a Data line, let's move on:
      return;
    }

    // Does this line look like a Flow?
    matches = lineIn.match(/^(.+)\[([\d\s.+-]+)\](.+)$/);
    if (matches !== null) {
      // The Amount looked trivially like a number; reject the line
      // if it really isn't:
      const amountIn = matches[2].replace(/\s/g, '');
      if (!isNumeric(amountIn)) {
        invalidLines.push({
          value: lineIn,
          message: 'The Amount is not a valid decimal number.',
        });
        return;
      }

      // Diagrams don't currently support negative numbers or 0:
      if (amountIn <= 0) {
        invalidLines.push({
          value: lineIn,
          message: 'Amounts must be greater than 0.',
        });
        return;
      }

      // All seems well, save it as good:
      goodFlows.push({
        source: matches[1].trim(),
        target: matches[3].trim(),
        amount: amountIn,
        sourceRow: row,
      });

      // We need to know the maximum precision of the inputs (greatest
      // # of characters to the RIGHT of the decimal) for some error
      // checking operations (& display) later:
      maxDecimalPlaces = Math.max(
        maxDecimalPlaces,
        ((amountIn.split(/\./))[1] || '').length
      );
      return;
    }

    // This is a non-blank line which did not match any pattern:
    invalidLines.push({
      value: lineIn,
      message: 'Does not match the format of a Flow or a Node.',
    });
  });

  // TODO: Disable useless precision checkbox if maxDecimalPlaces === 0
  // TODO: Look for cycles and post errors about them

  // Mention any un-parseable lines:
  invalidLines.forEach((parsingError) => {
    addMsgAbove(
      `&quot;<b>${escapeHTML(parsingError.value)}</b>&quot;: ${parsingError.message}`,
      'errormessage',
      false
    );
  });

  // Set up some data & functions that only matter from this point on:

  // approvedCfg begins with all the default values defined.
  // Values the user enters will override these (if present & valid).
  const approvedCfg = {
    auto_layout: true,
    iterations: 25,
    include_values_in_node_labels: 1,
    show_labels: 1,
    label_pos: 'inside',
    canvas_width: 600,
    canvas_height: 600,
    reveal_shadows: 0,
    font_size: 15,
    font_weight: 400,
    top_margin: 18, right_margin: 12, bottom_margin: 20, left_margin: 12,
    default_flow_opacity: 0.45,
    default_node_opacity: 1.0,
    mention_sankeymatic: 1,
    node_width: 9,
    node_height: 50,
    node_spacing: 85,
    node_border: 0,
    reverse_graph: 0,
    justify_origins: 0,
    justify_ends: 0,
    curvature: 0.5,
    default_flow_inherit: 'outside_in',
    default_flow_color: '#666666',
    background_color: '#FFFFFF',
    background_transparent: 0,
    font_color: '#000000',
    default_node_color: '#006699',
    default_node_colorset: 'C',
    font_face: 'sans-serif',
    label_highlight: 0.55,
    selected_theme_offset: 0,
    theme_a_offset: 7, theme_b_offset: 0,
    theme_c_offset: 0, theme_d_offset: 0,
    numberStyle: {
      marks: { group: ',', decimal: '.' },
      decimalPlaces: maxDecimalPlaces,
      trimString: '',
      prefix: '',
      suffix: '',
    },
  };

  // withUnits: Format a value with the current style.
  function withUnits(n) { return formatUserData(n, approvedCfg.numberStyle); }

  // explainSum: Returns an html string showing the flow amounts which
  // add up to a node's total value in or out.
  function explainSum(n, dir) {
    const formattedSum = withUnits(n.total[dir]),
      flowCt = n.flows[dir].length;
    if (flowCt === 1) { return formattedSum; }

    // When there are multiple amounts, the amount appears as a hover
    // target with a tooltip showing the breakdown in descending order.
    const breakdown = n.flows[dir].map((f) => f.value)
        .sort((a, b) => b - a)
        .map((v) => withUnits(v))
        .join(' + ');
    return `<dfn title="${formattedSum} from ${flowCt} `
      + `Flows: ${breakdown}">${formattedSum}</dfn>`;
  }

  // reset_field: We got bad input, so reset the form field to the default value
  function reset_field(fldName) {
    el(fldName).value = approvedCfg[fldName];
  }

  // get_color_input: If a field has a valid-looking HTML color value, then use it
  function get_color_input(fldName) {
    const fieldEl = el(fldName);
    let fldVal = fieldEl.value;
    if (fldVal.match(/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i)) {
      approvedCfg[fldName] = fldVal;
    } else if (fldVal.match(/^(?:[a-f0-9]{3}|[a-f0-9]{6})$/i)) {
      // Forgive colors with missing #:
      fldVal = `#${fldVal}`;
      approvedCfg[fldName] = fldVal;
      fieldEl.value = fldVal;
    } else {
      reset_field(fldName);
    }
  }

  // Make the final list of Flows:
  goodFlows.forEach((flow) => {
    // Look for extra content about this flow on the target-node end of the
    // string:
    let flowColor = '',
      opacity = '',
      // Try to parse; there may be extra info that isn't actually the name:
      // Format of the Target node can be:
      // TODO: Target node ["Custom name for flow"] [#color[.opacity]]
      // e.g. Clinton #CCDDEE
      // e.g. Gondor "Legolas" #998877.25
      // Look for an additional string starting with # for color info
      matches = flow.target.match(/^(.+)\s+(#\S+)$/);
    if (matches !== null) {
      // IFF the # string matches the pattern, separate the nodename
      // into parts. Assume a color will have at least 3 digits (rgb).
      const possibleNodeName = matches[1],
        possibleColor = matches[2];
      matches = possibleColor.match(/^#([0-9A-F]{3,6})?(\.\d{1,4})?$/i);
      if (matches !== null) {
        // Looks like we found a color or opacity or both.
        // Update the target's name with the trimmed string:
        flow.target = possibleNodeName;
        // If there was a color, adopt it:
        if (matches[1]) { flowColor = `#${matches[1]}`; }
        // If there was an opacity, adopt it:
        if (matches[2]) { opacity = matches[2]; }
      }
      // Otherwise just treat it as part of the nodename, e.g. "Team #1"
    }
    // Make sure the node names get saved; it may be their only appearance:
    addNodeName(flow.source, flow.sourceRow);
    addNodeName(flow.target, flow.sourceRow + 0.5);

    // Add the updated flow to the list of approved flows:
    const f = {
      index: approvedFlows.length,
      source: uniqueNodes.get(flow.source),
      target: uniqueNodes.get(flow.target),
      value: flow.amount,
      color: flowColor,
      opacity: opacity,
      hovering: false,
      sourceRow: flow.sourceRow,
    };
    if (graphIsReversed) {
      [f.source, f.target] = [f.target, f.source];
    }
    approvedFlows.push(f);
  });

  // Construct the final list of approved_nodes, sorted by their order of
  // appearance in the source:
  Array.from(uniqueNodes.values())
    .sort((a, b) => a.sourceRow - b.sourceRow)
    .forEach((n) => {
      // Set up color inheritance signals from '<<' and '>>' indicators:
      const paintL = n.paintInputs.some((s) => s === '<<'),
        paintR = n.paintInputs.some((s) => s === '>>');
      // If the graph is reversed, swap the directions:
      n.paint = {
        [BEFORE]: graphIsReversed ? paintR : paintL,
        [AFTER]: graphIsReversed ? paintL : paintR,
      };
      // After establishing the above, the raw paint inputs aren't needed:
      delete n.paintInputs;
      n.index = approvedNodes.length;

      approvedNodes.push(n);
    });

  // Whole positive numbers:
  (['canvas_width', 'canvas_height', 'font_size',
    'top_margin', 'right_margin', 'bottom_margin',
    'left_margin', 'font_weight', 'node_height',
    'node_width', 'node_spacing',
    'node_border', 'iterations']).forEach((fldName) => {
    const fldVal = elV(fldName);
    if (fldVal.length < 10 && fldVal.match(/^\d+$/)) {
      approvedCfg[fldName] = Number(fldVal);
    } else {
      reset_field(fldName);
    }
  });

  // Vet the color theme offset fields:
  colorThemes.forEach((theme, themeKey) => {
    const fldName = `theme_${themeKey}_offset`,
        fldVal = elV(fldName);
    // Verify that the number matches up with the possible offset
    // range for each theme.
    // It has to be either 1 or 2 digits (some ranges have > 9 options):
    if (fldVal.match(/^\d{1,2}$/)
      // No '-', so it's at least a positive number. Is it too big?:
      && Number(fldVal) <= (theme.colorset.length - 1)) {
      // It's a valid offset, let it through:
      approvedCfg[fldName] = Number(fldVal);
    } else {
      reset_field(fldName);
    }
  });

  (['default_flow_color', 'background_color', 'font_color',
    'default_node_color']).forEach((fldName) => {
    get_color_input(fldName);
  });

  // Since we know the canvas' intended size now, go ahead & set that up
  // (before we potentially quit):
  chartEl.style.height = `${approvedCfg.canvas_height}px`;
  chartEl.style.width = `${approvedCfg.canvas_width}px`;

  // Are there any good flows at all? If not, offer a little help & exit:
  if (!goodFlows.length) {
    addMsgAbove(
      'Enter a list of Flows &mdash; one per line. '
      + 'See the <a href="/manual/" target="_blank">Manual</a> for more help.',
      'okmessage',
      true
    );

    // Clear the contents of the graph in case there was an old graph left
    // over:
    initializeDiagram(approvedCfg);

    // Also clear out any leftover export output by rendering the
    // currently-blank canvas:
    glob.renderExportableOutputs();

    // No point in proceeding any further. Return to the browser:
    return null;
  }

  // Verify valid plain strings:
  (['unit_prefix', 'unit_suffix']).forEach((fldName) => {
    const fldVal = elV(fldName);
    approvedCfg.numberStyle[fldName.slice(-6)]
      = (typeof fldVal !== 'undefined'
        && fldVal !== null
        && fldVal.length <= 10)
        ? fldVal
        : '';
  });

  // Interpret user's number format settings:
  (['number_format']).forEach((fldName) => {
    const fldVal = elV(fldName);
    if (fldVal.length === 2 && (/^[,. X][,.]$/.exec(fldVal))) {
      // Grab the 1st character if it's a valid 'group' value:
      const groupMark = (/^[,. X]/.exec(fldVal))[0];
      // No Separator (X) is a special case:
      approvedCfg.numberStyle.marks.group
        = groupMark === 'X' ? '' : groupMark;
      // Grab the 2nd character if it's a valid 'decimal' value:
      approvedCfg.numberStyle.marks.decimal
        = (/^.([,.])/.exec(fldVal))[1];
    } else {
      reset_field(fldName);
    }
  });

  // RADIO VALUES:

  // Direction of flow color inheritance:
  let flowInherit = radioRef('default_flow_inherit').value;
  if (['source', 'target', 'outside_in', 'none'].includes(flowInherit)) {
    if (graphIsReversed) {
      switch (flowInherit) {
        case 'source': flowInherit = 'target'; break;
        case 'target': flowInherit = 'source'; break;
        // no default
      }
    }
    approvedCfg.default_flow_inherit = flowInherit;
  }

  const labelPosIn = radioRef('label_pos').value;
  if (['before', 'after', 'inside', 'outside'].includes(labelPosIn)) {
    approvedCfg.label_pos = labelPosIn;
  }

  const fontFaceIn = radioRef('font_face').value;
  if (['serif', 'sans-serif', 'monospace'].includes(fontFaceIn)) {
    approvedCfg.font_face = fontFaceIn;
  }

  const layoutStyle = radioRef('layout_style').value;
  if (['auto', 'exact'].includes(layoutStyle)) {
    approvedCfg.auto_layout = (layoutStyle === 'auto');
  }

  const colorsetIn = radioRef('default_node_colorset').value;
  if (['a', 'b', 'c', 'd', 'none'].includes(colorsetIn)) {
    approvedCfg.default_node_colorset = colorsetIn;
    // Given the selected theme, what's the specific offset for that theme?
    approvedCfg.selected_theme_offset
      = colorsetIn === 'none'
      ? 0
      : approvedCfg[`theme_${colorsetIn}_offset`];
  }

  // Checkboxes:
  (['include_values_in_node_labels', 'show_labels',
    'background_transparent', 'justify_origins', 'justify_ends',
    'mention_sankeymatic', 'reveal_shadows']).forEach((fldName) => {
    approvedCfg[fldName] = el(fldName).checked;
  });

  // Decimal:
  (['default_node_opacity', 'default_flow_opacity', 'label_highlight',
    'curvature']).forEach((fldName) => {
    const fldVal = elV(fldName);
    if (fldVal.match(/^\d(?:.\d+)?$/)) {
      approvedCfg[fldName] = fldVal;
    } else {
      reset_field(fldName);
    }
  });

  // Finish setting up the numberStyle object. (It's used in render_sankey.)
  // 'trimString' = string to be used in the d3.format expression later:
  approvedCfg.numberStyle.trimString
    = el('display_full_precision').checked ? '' : '~';

  // All is ready. Do the actual rendering:
  render_sankey(approvedNodes, approvedFlows, approvedCfg);

  // Re-make the PNG+SVG outputs in the background so they are ready to use:
  glob.renderExportableOutputs();

  // POST-RENDER ACTIVITY: various stats and UI updates.

  // Given maxDecimalPlaces, we can derive the smallest important
  // difference, defined as smallest-input-decimal/10; this lets us work
  // around various binary/decimal math issues.
  const epsilonDifference = 10 ** (-maxDecimalPlaces - 1);

  // After rendering, there are now more keys in the node records, including
  // 'total' and 'value'.
  approvedNodes.forEach((n, i) => {
    // Skip checking any nodes with 0 as the From or To amount; those are
    // the origins & endpoints for the whole graph and don't qualify:
    if (n.total[IN] > 0 && n.total[OUT] > 0) {
      const difference = n.total[IN] - n.total[OUT];
      // Is there a difference big enough to matter? (i.e. > epsilon)
      // We'll always calculate this, even if not shown to the user.
      if (Math.abs(difference) > epsilonDifference) {
        differences.push({
          name: n.name,
          total_in: explainSum(n, IN),
          total_out: explainSum(n, OUT),
          difference: withUnits(difference),
        });
      }
    } else {
      // Accumulate totals in & out of the graph
      // (On this path, one of these values will be 0 every time.)
      totalInflow += n.total[IN];
      totalOutflow += n.total[OUT];
    }

    // Btw, check if this is a new maximum node:
    if (n.value > maxNodeVal) {
      maxNodeIndex = i;
      maxNodeVal = n.value;
    }
  });

  // Update UI options based on the presence of mismatched rows:
  if (differences.length) {
    // Enable the controls for letting the user show the differences:
    listDifferencesEl.disabled = false;
    differencesEl.setAttribute('aria-disabled', false);
  } else {
    // Disable the controls for telling the user about differences:
    listDifferencesEl.disabled = true;
    differencesEl.setAttribute('aria-disabled', true);
  }

  // Were there any differences, and does the user want to know?
  if (differences.length && listDifferencesEl.checked) {
    // Construct a hyper-informative error message about any differences:
    const differenceRows = [
      '<tr><td></td><th>Total In</th><th>Total Out</th><th>Difference</th></tr>',
    ];
    // Make a nice table of the differences:
    differences.forEach((diffRec) => {
      differenceRows.push(
        `<tr><td class="nodename">${escapeHTML(diffRec.name)}</td>`
        + `<td>${diffRec.total_in}</td>`
        + `<td>${diffRec.total_out}</td>`
        + `<td>${diffRec.difference}</td></tr>`
      );
    });
    setDifferencesMsg(
      `<table class="center_basic">${differenceRows.join('\n')}</table>`
    );
  } else {
    // Clear the messages area:
    setDifferencesMsg('');
  }

  // Reflect summary stats to the user:
  statusMsg
    = `<strong>${approvedFlows.length} Flows</strong> between `
    + `<strong>${approvedNodes.length} Nodes</strong>. `;

  // Do the totals match? If not, mention the different totals:
  if (Math.abs(totalInflow - totalOutflow) > epsilonDifference) {
    const gtLt = totalInflow > totalOutflow ? '&gt;' : '&lt;';
    statusMsg
      += `Total Inputs: <strong>${withUnits(totalInflow)}</strong> ${gtLt}`
      + ` Total Outputs: <strong>${withUnits(totalOutflow)}</strong>`;
  } else {
    statusMsg += 'Total Inputs = Total Outputs = '
      + `<strong>${withUnits(totalInflow)}</strong> &#9989;`;
  }
  setTotalsMsg(statusMsg);

  updateColorThemeDisplay();

  // Now that the SVG code has been generated, figure out this diagram's
  // Scale & make that available to the user:
  const tallestNodeHeight
    = parseFloat(el(`r${maxNodeIndex}`).getAttributeNS(null, 'height')),
    // Use <=2 decimal places to describe the tallest node's height:
    formattedPixelCount = updateMarks(
      d3.format(',.2~f')(tallestNodeHeight),
      approvedCfg.numberStyle.marks
    ),
    // Show this value using the user's units, but override the number of
    // decimal places to show 4 digits of precision:
    unitsPerPixel = formatUserData(
      maxNodeVal / tallestNodeHeight,
      { ...approvedCfg.numberStyle, decimalPlaces: 4 }
    );
  el('scale_figures').innerHTML
    = `<strong>${unitsPerPixel}</strong> per pixel `
    + `(${withUnits(maxNodeVal)}/${formattedPixelCount}px)`;

  updateResetNodesUI();

  // All done. Give control back to the browser:
  return null;
};

// Render the default diagram on first load:
glob.process_sankey();
}(window === 'undefined' ? global : window));

// Make the linter happy about imported objects:
/* global d3, canvg, sampleDiagramRecipes, global, fontMetrics, highlightStyles IN OUT
  BEFORE AFTER */
