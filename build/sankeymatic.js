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
"use strict";

// 'glob' points to the global object, either 'window' (browser) or 'global' (node.js)
// This lets us contain everything in an IIFE (Immediately-Invoked Function Expression)

// el: shorthand for grabbing a DOM element:
function el(domId) { return document.getElementById(domId); }

// togglePanel: Called directly from the page.
// Given a panel's name, hide or show that control panel.
glob.togglePanel = (panel) => {
    const panelEl = el(panel),
        // Set up the new values:
        newVals = panelEl.style.display === 'none'
            ? { display: '', suffix: ':', action: '&ndash;' }
            : { display: 'none', suffix: '...', action: '+' };
    panelEl.style.display = newVals.display;
    el(`${panel}_hint`).innerHTML = newVals.suffix;
    el(`${panel}_indicator`).innerHTML = newVals.action;
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
         .replaceAll('→', "&#8594;")
         .replaceAll('&', "&amp;")
         .replaceAll('<', "&lt;")
         .replaceAll('>', "&gt;")
         .replaceAll('"', "&quot;")
         .replaceAll("'", "&#039;")
         .replaceAll("\n", "<br />");
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

// svgBackgroundClass: Generate the class clause for the svg's top level:
function svgBackgroundClass(transparent) {
    return `svg_background_${transparent ? 'transparent' : 'default'}`;
}

// makeDiagramBlank: reset the SVG tag to be empty, with a pattern backing
// if the user wants it to be transparent:
function makeDiagramBlank(cfg) {
    // Simply emptying the SVG tag doesn't seem to work well in Safari,
    // so we remake the whole tag instead:
    el('chart').innerHTML
        = '<svg id="sankey_svg" xmlns="http://www.w3.org/2000/svg" version="1.1" '
        + `height="${cfg.canvas_height}" width="${cfg.canvas_width}" `
        + `class="${svgBackgroundClass(cfg.background_transparent)}"></svg>`;
}

// render_png: Build a PNG file in the background
function render_png(curDate) {
    const chartEl = el('chart'),
        origW = chartEl.clientWidth,
        origH = chartEl.clientHeight,
        // What scale does the user want (1,2,4,6)?:
        scaleFactor = clamp(el('scale_x').value, 1, 6),
        scaledW = origW * scaleFactor,
        scaledH = origH * scaleFactor,
        // Find the (hidden) canvas element in our page:
        canvasEl = el('png_preview'),
        // Set up the values Canvg will need:
        canvasContext = canvasEl.getContext("2d"),
        svgEl = el('sankey_svg'),
        svgContent = (new XMLSerializer()).serializeToString(svgEl),
        // More targets we'll be changing on the page:
        pngLinkEl = el('download_png_link'),
        // Generate yyyymmdd_hhmmss string:
        fileTimestamp
            = (curDate.toISOString().replace(/T.+$/, '_')
            + curDate.toTimeString().replace(/ .+$/, ''))
                .replace(/[:-]/g, ''),
        // Canvg 3 needs interesting offsets added when scaling up:
        offsetX = (scaledW - origW) / (2 * scaleFactor),
        offsetY = (scaledH - origH) / (2 * scaleFactor);

    // Set the canvas element to the final height/width the user wants:
    canvasEl.width = scaledW;
    canvasEl.height = scaledH;

    // Update img tag hint with user's original dimensions:
    el('img_tag_hint_w').innerHTML = origW;
    el('img_tag_hint_h').innerHTML = origH;

    // Give Canvg what it needs to produce a rendered image:
    const canvgObj = canvg.Canvg.fromString(
        canvasContext,
        svgContent,
        {
            ignoreMouse: true,
            ignoreAnimation: true,
            ignoreDimensions: true, // DON'T make the canvas size match the svg
            scaleWidth: scaledW,
            scaleHeight: scaledH,
            offsetX: offsetX,
            offsetY: offsetY,
        }
    );
    canvgObj.render();

    // Convert canvas image to a URL-encoded PNG and update the link:
    pngLinkEl.setAttribute("href", canvasEl.toDataURL('image/png'));
    pngLinkEl.setAttribute("target", "_blank");

    // update download link & filename with dimensions:
    pngLinkEl.innerHTML = `Export ${scaledW} x ${scaledH} PNG`;
    pngLinkEl.setAttribute("download", `sankeymatic_${fileTimestamp}_${scaledW}x${scaledH}.png`);
}

// produce_svg_code: take the current state of 'sankey_svg' and
// relay it nicely to the user
function produce_svg_code(curDate) {
  // For the user-consumable SVG code, make a copy of the real SVG & put in a
  // title placeholder & credit:
  const svgForCopying
    // Read the live SVG structure and tweak it:
    = el('chart').innerHTML
        // Take out the id and the class declaration for the background:
        .replace(' id="sankey_svg"', '')
        .replace(/ class="svg_background_[a-z]+"/, '')
        // Insert some helpful tags in front of the FIRST inner tag:
        .replace(
            />/,
            ">\n<title>Your Diagram Title</title>\n"
            + `<!-- Generated with SankeyMATIC: ${curDate.toLocaleString()} -->\n`
            )
        // Add some line breaks to highlight where [g]roups start/end
        // and where each [path] and [text] start:
        .replace(/<(g|\/g|path|text)/g, "\n<$1");

  // Escape that whole batch of tags and put it in the <div> for copying:
  el('svg_for_export').innerHTML = escapeHTML(svgForCopying);
}

// Pure functions for generating SVG path specs:
// CURVED path function generator:
// Returns a /function/ specific to the user's curvature choice.
// Used for the "d" attribute on a "path" element when curvature > 0
function curvedFlowPathFunction(curvature) {
    return (f) => {
        const xS = f.source.x + f.source.dx,      // source's trailing edge
            xT = f.target.x,                      // target's leading edge
            ySc = f.source.y + f.sy + f.dy / 2,   // source flow vert. center
            yTc = f.target.y + f.ty + f.dy / 2,   // target flow vert. center
            // Set up a function for interpolating between the two x values:
            xinterpolate = d3.interpolateNumber(xS, xT),
            // Pick 2 curve control points given the curvature & its converse:
            xC1 = xinterpolate(curvature),
            xC2 = xinterpolate(1 - curvature);
        // This SVG Path spec means:
        // [M]ove to the center of the flow's start
        // Draw a Bezier [C]urve using control points (xc1,ysc) + (xc2,ytc)
        // End at the center of the flow's target
        return `M${ep(xS)} ${ep(ySc)}C${ep(xC1)} ${ep(ySc)}`
            + ` ${ep(xC2)} ${ep(yTc)} ${ep(xT)} ${ep(yTc)}`;
    };
}

// FLAT path function:
// Used for the "d" attribute on a "path" element when curvature = 0
function flatFlowPathMaker(f) {
    const xS = f.source.x + f.source.dx,  // source's trailing edge
        xT = f.target.x,                  // target's leading edge
        ySTop = f.source.y + f.sy,        // source flow top
        yTBot = f.target.y + f.ty + f.dy; // target flow bottom
    // This SVG Path spec means:
    // [M]ove to the flow source's top; draw a [v]ertical line down,
    // a [L]ine to the opposite corner, a [v]ertical line up, then [z] close.
    return `M${ep(xS)} ${ep(ySTop)}v${ep(f.dy)}`
        + `L${ep(xT)} ${ep(yTBot)}v-${ep(f.dy)}z`;
}

// renderExportableOutputs: Called directly from the page (and from below).
// Kick off a re-render of the static image and the user-copyable SVG code.
// Used after each draw & when the user chooses a new PNG resolution.
glob.renderExportableOutputs = () => {
    // Reset the existing export output areas:
    const pngLinkEl = el('download_png_link'),
        curDate = new Date();

    // Clear out the old image link, cue user that the graphic isn't yet ready:
    pngLinkEl.innerHTML = '...creating downloadable graphic...';
    pngLinkEl.setAttribute('href', '#');

    // Wipe out the SVG from the old diagram:
    el('svg_for_export').innerHTML = '(generating SVG code...)';

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
    el('replace_graph_warning').style.display = "none";
    return null;
};

// replaceGraphConfirmed: Called directly from the page (and from below).
// It's ok to overwrite the user's inputs now. Let's go.
// (Note: In order to reach this code, we have to have already verified the
// presence of the named recipe, so we don't re-verify.)
glob.replaceGraphConfirmed = () => {
    const graphName = el('demo_graph_chosen').value,
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
    const userInputs = el('flows_in').value,
        inputsMatchAnySample = Array.from(sampleDiagramRecipes.values())
            .some((r) => r.flows === userInputs);

    if (inputsMatchAnySample || userInputs === '') {
        // The user has NOT changed the input from one of the samples,
        // or the whole field is blank. Go ahead with the change:
        glob.replaceGraphConfirmed();
    } else {
        // Show the warning and do NOT replace the graph:
        el('replace_graph_warning').style.display = "";
        el('replace_graph_yes').innerHTML
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
    let stagesArr = []; // each Stage in the diagram (and the Nodes inside them)

    // stagesMidpoint: Helpful value for deciding if something is in the first
    // or last half of the diagram:
    function stagesMidpoint() { return (stagesArr.length - 1) / 2; }

    // withUnits: Format a value with the current style.
    function withUnits(n) { return formatUserData(n, cfg.numberStyle); }

    // Drawing curves with curvature of <= 0.1 looks bad and produces visual
    // artifacts, so let's just take the lowest value on the slider (0.1)
    // and call that 0/flat:
    const flowsAreFlat = (cfg.curvature <= 0.1),
        // flowPathFn is a function returning coordinates and specs for each
        // flow. (Flat flows use their own simpler function.)
        flowPathFn = flowsAreFlat
            ? flatFlowPathMaker
            : curvedFlowPathFunction(cfg.curvature);

    // What color is a flow?
    function flow_final_color(f) {
        // Stroke Color priority order:
        // 1. color defined specifically for the flow
        // 2. single-inheritance-from-source (or target)
        // 3. default-inheritance-from-source/target/outside_in
        // 4. default flow color
        return f.color ? f.color
            : f.source.paint_right ? f.source.color
            : f.target.paint_left ? f.target.color
            : cfg.default_flow_inherit === 'source' ? f.source.color
            : cfg.default_flow_inherit === 'target' ? f.target.color
            : cfg.default_flow_inherit === 'outside_in'
              // Is the midpoint of the flow in the right half, or left?
              // (If it's in the exact middle, we use the source color.)
            ? ((f.source.stage + f.target.stage) / 2 <= stagesMidpoint()
                ? f.source.color
                : f.target.color)
            : cfg.default_flow_color;
    }

    // Establish a list of compatible colors to choose from:
    const userColorArray = cfg.default_node_colorset === "none"
        // User wants a color array with just the one value:
        ? [cfg.default_node_color]
        : rotateColors(
            approvedColorTheme(cfg.default_node_colorset).colorset,
            cfg.selected_theme_offset
            ),
        colorScaleFn = d3.scaleOrdinal(userColorArray);

    // Fill in any un-set node colors up front so flows can inherit colors
    // from them:
    allNodes.forEach((node) => {
        if (typeof node.color === 'undefined' || node.color === '') {
            // Use the first non-blank portion of the label as the basis for
            // adopting an already-used color or picking a new one.
            // (Note: this is case sensitive!)
            // If there are no non-blank strings in the node name, substitute
            // a word-ish value (rather than crash):
            const firstBlock
                = (/^\s*(\S+)/.exec(node.name) || ['', 'name-is-blank'])[1];
            node.color = colorScaleFn(firstBlock);
        }
    });

    // Fill in any missing opacity values and the 'hover' counterparts:
    allFlows.forEach((f) => {
        f.opacity = f.opacity || cfg.default_flow_opacity;
        f.opacity_on_hover = (Number(f.opacity) + 1) / 2;
    });

    // At this point, allNodes and allFlows are ready to go.

    // Set the dimensions of the space:
    // (This will get much more complicated once we start auto-fitting labels.)
    const graphW = cfg.canvas_width - cfg.left_margin - cfg.right_margin,
        graphH = cfg.canvas_height - cfg.top_margin - cfg.bottom_margin,
        // Create the sankey object & its properties.
        // NOTE: The call to d3.sankey().setup() will further MODIFY the
        // allNodes and allFlows objects -- filling in specifics about layout
        // positions, etc.
        sankeyObj = d3.sankey()
            .nodeWidth(cfg.node_width)
            .nodeSpacingFactor(cfg.node_spacing / 100)
            .size([graphW, graphH])
            .nodes(allNodes)
            .flows(allFlows)
            .rightJustifyEndpoints(cfg.justify_ends)
            .leftJustifyOrigins(cfg.justify_origins)
            .setup();

    sankeyObj.layout(50); // Note: The 'layout()' step must be LAST.

    // Get the final stages array (might be used for outside-in colors):
    stagesArr = sankeyObj.stages();

    // Now that the stages & values are known, we can set up more label data:
    if (cfg.show_labels) {
        allNodes.forEach((n) => {
            n.label_text
                = cfg.include_values_in_node_labels
                    ? `${n.name}: ${withUnits(n.value)}`
                    : n.name;

            let leftLabel = true;
            switch (cfg.label_pos) {
                case 'all_left': break;
                case 'all_right': leftLabel = false; break;
                // 'auto', a.k.a. 'inner': If the node's stage is in the FIRST
                // half of all stages (excluding the middle stage if there is
                // one), put the label AFTER the node.
                case 'auto': leftLabel = n.stage >= stagesMidpoint();
                // no default
            }

            // Having picked left/right, now we can set specific values:
            n.label_x = leftLabel ? n.x - 6 : n.x + cfg.node_width + 6;
            n.label_anchor = leftLabel ? 'end' : 'start';
        });
    }

    // ...and fill in more Flow details as well:
    allFlows.forEach((f) => {
        f.tooltip
            = `${f.source.name} → ${f.target.name}:\n${withUnits(f.value)}`;
    });

    // Draw!

    // Clear out any old contents:
    makeDiagramBlank(cfg);

    // Select the svg canvas; set the defined dimensions:
    const diagramRoot = d3.select("#sankey_svg")
        .attr("height", cfg.canvas_height)
        .attr("width", cfg.canvas_width)
        .attr("class", svgBackgroundClass(cfg.background_transparent));

    // If a background color is defined, add a backing rectangle with that color:
    if (!cfg.background_transparent) {
        // Note: This just adds the rectangle *without* changing the d3
        // selection stored in diagramRoot:
        diagramRoot.append("rect")
            .attr("height", cfg.canvas_height)
            .attr("width", cfg.canvas_width)
            .attr("fill", cfg.background_color);
    }

    // Hovering over a flow increases its opacity:
    function setFlowHoverOpacity(_, f) {
        d3.select(this).style('opacity', f.opacity_on_hover);
    }
    // Leaving a flow restores its original opacity:
    function setFlowOpacity(_, f) {
        d3.select(this).style('opacity', f.opacity);
    }

    // Add a [g]roup which moves the remaining diagram inward based on the
    // user's margins.
    const diagMain = diagramRoot.append("g")
            .attr("transform", `translate(${cfg.left_margin},${cfg.top_margin})`),
        // Set up the [g]roup of rendered flows:
        // diagFlows = the d3 selection of all flow paths:
        diagFlows = diagMain.append("g")
            .attr("id", "sankey_flows")
          .selectAll(".link")
          .data(allFlows)
          .enter()
          .append("path")
            .attr("class", "link")
            .attr("d", flowPathFn) // set the SVG path for each flow
            .style("stroke", (d) => flow_final_color(d))
            .style("opacity", (f) => f.opacity)
          // add emphasis-on-hover behavior:
          .on('mouseover', setFlowHoverOpacity)
          .on('mouseout', setFlowOpacity)
          // Sort flows to be rendered from largest to smallest
          // (so if flows cross, the smaller are drawn on top of the larger):
          .sort((a, b) => b.dy - a.dy);

    if (flowsAreFlat) {
        // When flows have no curvature at all, they're really parallelograms.
        // The fill is the main source of color then:
        diagFlows.style("fill", (d) => flow_final_color(d))
            // We add a little bit of a stroke because the outermost flows look
            // overly thin otherwise. (They still can, even with this addition.)
           .style("stroke-width", 0.5);
    } else {
        // When curved, there is no fill, only stroke-width:
        diagFlows.style("fill", "none")
            // Make sure any flow, no matter how small, is visible (1px wide):
            .style("stroke-width", (d) => ep(Math.max(1, d.dy)));
    }

    // Add a tooltip for each flow:
    diagFlows.append('title').text((f) => f.tooltip);

    // MARK Drag functions

    // isAZeroMove: simple test of whether every offset is 0 (no move at all):
    function isAZeroMove(a) { return a.every((m) => m === 0); }

    // Given a Node index, apply its move to the SVG & remember it for later:
    function applyNodeMove(index) {
        const n = allNodes[index],
            graphIsReversed = el('reverse_graph').checked,
            // In the case of a reversed graph, we negate the x-move:
            myXMove = n.move[0] * (graphIsReversed ? -1 : 1),
            availableW = graphW - n.dx,
            availableH = graphH - n.dy;

        // Apply the move to the node (halting at the edges of the graph):
        n.x = Math.max(
            0,
            Math.min(availableW, n.origPos.x + availableW * myXMove)
            );
        n.y = Math.max(
            0,
            Math.min(availableH, n.origPos.y + availableH * n.move[1])
            );

        // Find everything which shares the class of the dragged node and
        // translate each with these offsets.
        // Currently this means the node and its label, if present.
        // (Why would we apply a null transform? Because it may have been
        // transformed already & we are now undoing the previous operation.)
        d3.selectAll(`#sankey_svg .for_r${index}`)
            .attr("transform", isAZeroMove(n.move)
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
        // calculated path:
        diagFlows.attr("d", flowPathFn);

        // Regenerate the exportable versions:
        glob.renderExportableOutputs();
    }

    // Show helpful guides/content for the current drag. We put it all in a
    // distinct 'g'roup for helper content so we can remove it easily later:
    function dragNodeStarted(event, d) {
        const grayColor = contrasting_gray_color(cfg.background_color);
        let diagHelperLayer = diagMain.select("#helper_layer");
        // Create the helper layer if it doesn't exist:
        if (!diagHelperLayer.nodes.length) {
            // Insert it just before (i.e. 'under') the 'nodes' layer, so it
            // doesn't interfere with things like double-clicks on nodes.
            diagHelperLayer = diagMain.insert("g", "#sankey_nodes")
              .attr("id", "helper_layer")
              // Set up attributes common to all the stuff inside here..
              .style("fill", grayColor)
              .style("fill-opacity", 0.5)
              .style("stroke", "none");
        }

        // Draw 4 horizontal/vertical guide lines, along the edges of the
        // place where the drag began (d.lastPos):
        diagHelperLayer.append("path")
          .attr("id", "helper_lines")
          // This SVG Path spec means:
          // [M]ove to the left edge of the graph at this node's top
          // [h]orizontal line across the whole graph width
          // [m]ove down by this node's height
          // [H]orizontal line back to the left edge (x=0)
          // ..Then the same operation [v]ertically, using this node's width.
          .attr("d", `M0 ${ep(d.lastPos.y)} h${ep(graphW)} m0 ${ep(d.dy)} H0`
                   + `M${ep(d.lastPos.x)} 0 v${ep(graphH)} m${ep(d.dx)} 0 V0`)
          .style("stroke", grayColor)
          .style("stroke-width", 1)
          .style("stroke-dasharray", "1 3")
          .style("stroke-opacity", 0.7);

        // Put a ghost rectangle where this node started out:
        diagHelperLayer.append("rect")
          .attr("id", "helper_original_rect")
          .attr("x", ep(d.origPos.x))
          .attr("y", ep(d.origPos.y))
          .attr("height", ep(d.dy))
          .attr("width", cfg.node_width)
          .style("fill", d.color)
          .style("fill-opacity", 0.3);

        // Check for the Shift key. If it's down when starting the drag, skip
        // the hint:
        if (!(event.sourceEvent && event.sourceEvent.shiftKey)) {
            // Place hint text where it can hopefully be seen,
            // in a [g]roup which can be removed later during dragging:
            const shiftHints = diagHelperLayer.append("g")
                  .attr("id", "helper_shift_hints")
                  .style("font-size", "14px")
                  .style("font-weight", "400"),
                hintHeights = graphH > 350 ? [0.05, 0.95] : [0.4];
            // Show the text so it's visible but not overwhelming:
            hintHeights.forEach((h) => {
                shiftHints.append("text")
                  .attr("text-anchor", "middle")
                  .attr("x", graphW / 2)
                  .attr("y", graphH * h)
                 .text("Hold down Shift to move in only one direction");
            });
        }
        return null;
    }

    // This is called _during_ Node drags:
    function draggingNode(event, d) {
        // Fun fact: In this context, event.subject is the same thing as 'd'.
        let myX = event.x,
            myY = event.y;
        const graphIsReversed = el('reverse_graph').checked;

        // Check for the Shift key:
        if (event.sourceEvent && event.sourceEvent.shiftKey) {
            // Shift is pressed, so this is a constrained drag.
            // Figure out which direction the user has dragged _further_ in:
            if (Math.abs(myX - d.lastPos.x) > Math.abs(myY - d.lastPos.y)) {
                myY = d.lastPos.y; // Use X move; keep Y constant
            } else {
                myX = d.lastPos.x; // Use Y move; keep X constant
            }
            // If they've Shift-dragged, they don't need the hint any more -
            // remove it and don't bring it back until the next gesture.
            const shiftHint = diagMain.select("#helper_shift_hints");
            if (shiftHint.nodes) { shiftHint.remove(); }
        }

        // Calculate the percentages we want to save (which will stay
        // independent of the graph's edge constraints, even if the spacing,
        // etc. changes to distort them):
        d.move = [
            // If the graph is RTL, calculate the x-move as though it is LTR:
            (graphIsReversed ? -1 : 1) * ((myX - d.origPos.x) / (graphW - d.dx)),
            (graphH === d.dy) ? 0 : (myY - d.origPos.y) / (graphH - d.dy),
        ];

        applyNodeMove(d.index);
        // Note: We DON'T rememberNodeMove after every pixel-move of a drag;
        // just when a gesture is finished.
        reLayoutDiagram();
        return null;
    }

    // (Investigate: This is called on every ordinary *click* as well; look
    // into skipping this work if no actual move has happened.)
    function dragNodeEnded(event, d) {
        // Take away the helper guides:
        const helperLayer = diagMain.select("#helper_layer");
        if (helperLayer.nodes) { helperLayer.remove(); }

        // After a drag is finished, any new constrained drag should use the
        // _new_ position as 'home'. Therefore we have to set this as the
        // 'last' position:
        rememberNodeMove(d);
        reLayoutDiagram();
        return null;
    }

    // A double-click resets a node to its default rendered position:
    function doubleClickNode(event, d) {
        d.move = [0, 0];
        applyNodeMove(d.index);
        rememberNodeMove(d);
        reLayoutDiagram();
        return null;
    }

    // Set up the [g]roup of nodes, including drag behavior:
    const diagNodes = diagMain.append("g")
        .attr("id", "sankey_nodes")
        .attr("shape-rendering", "crispEdges")
        .style("stroke-width", cfg.node_border || 0)
      .selectAll(".node")
      .data(allNodes)
      .enter()
      .append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragNodeStarted)
            .on("drag", draggingNode)
            .on("end", dragNodeEnded))
        .on("dblclick", doubleClickNode);

    // Construct the actual rectangles for NODEs:
    diagNodes.append("rect")
        .attr("x", (d) => ep(d.x))
        .attr("y", (d) => ep(d.y))
        .attr("height", (d) => ep(d.dy))
        .attr("width", cfg.node_width)
        // Give a unique ID & class to each rect that we can reference:
        .attr("id", (d) => `r${d.index}`)
        .attr("class", (d) => `for_r${d.index}`)
        // we made sure above there will be a color defined:
        .style("fill", (d) => d.color)
        .style("fill-opacity", (d) => d.opacity || cfg.default_node_opacity)
        .style("stroke", (d) => d3.rgb(d.color).darker(2))
      // Add tooltips showing node totals:
      .append("title")
        .text((d) => `${d.name}:\n${withUnits(d.value)}`);

    const diagLabels = diagMain.append("g")
        .attr("id", "sankey_labels")
        // These font spec defaults apply to all labels within
        .style("font-family", cfg.font_face)
        .style("font-size", `${cfg.font_size}px`)
        .style("font-weight", cfg.font_weight)
        .style("fill", cfg.font_color);
    if (cfg.mention_sankeymatic) {
        diagLabels.append("text")
            // Anchor the text to the midpoint of the canvas (not the graph):
            .attr("text-anchor", "middle")
            // x = graphW/2 is wrong when the L/R margins are uneven.. We
            // have to use the whole width & adjust for the graph's transform:
            .attr("x", cfg.canvas_width / 2 - cfg.left_margin)
            .attr("y", graphH + cfg.bottom_margin - 5)
            // Keep the current font, but make this small & grey:
            .style("font-size", "11px")
            .style("font-weight", "400")
            .style("fill", contrasting_gray_color(cfg.background_color))
            .text("Made with SankeyMATIC");
    }

    if (cfg.show_labels) {
        // Add labels in a distinct layer on the top (so nodes can't block them)
        diagLabels.selectAll()
          .data(allNodes)
          .enter()
          .append("text")
            .attr('x', (n) => ep(n.label_x))
            .attr('y', (n) => ep(n.y + n.dy / 2))
            .attr('text-anchor', (n) => n.label_anchor)
            // Move letters down by 1/3 of a wide letter's width
            // (makes them look vertically centered)
            .attr('dy', '.35em')
            // Associate this label with its node:
            .attr('class', (n) => `for_r${n.index}`)
            .text((n) => n.label_text);
    }

    // Now that all of the SVG nodes and labels exist, it's time to re-apply
    // any remembered moves:
    if (glob.rememberedMoves.size) {
        // Make a copy of the list of moved-Node names (so we can destroy it):
        const movedNodes = new Set(glob.rememberedMoves.keys());

        // Look for all node objects matching a name in the list:
        allNodes.filter((n) => movedNodes.has(n.name))
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
    let maxDecimalPlaces = 0, totalInflow = 0, totalOutflow = 0,
        statusMsg = '', maxNodeIndex = 0, maxNodeVal = 0;
    const invalidLines = [],
        uniqueNodes = new Map(), approvedNodes = [],
        goodFlows = [], approvedFlows = [],
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
            + `&nbsp;</span>`
        );
        for (const t of colorThemes.keys()) {
            const theme = approvedColorTheme(t),
                themeOffset = el(`theme_${t}_offset`).value,
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
    messagesEl.innerHTML = '';

    // Go through lots of validation with plenty of bailout points and
    // informative messages for the poor soul trying to do this.

    // MARK UI updates based on user choices

    // Checking the 'Transparent' background-color box *no longer* means that
    // the color-picker is pointless; it still affects the color value which
    // will be given to "Made with SankeyMATIC".
    // Therefore, we no longer disable the Background Color element, even when
    // 'Transparent' is checked.

    // If the user is setting Label positions to either left or right (i.e. not
    // 'auto'), show the margin hint:
    const labelPosVal = radioRef("label_pos").value;
    el('label_pos_note').innerHTML
        = (labelPosVal === "all_left"
            ? "Adjust the <strong>Left Margin</strong> above to fit your labels"
            : labelPosVal === "all_right"
            ? "Adjust the <strong>Right Margin</strong> above to fit your labels"
            : "");

    // Flows validation:

    // addNodeName: Make sure a node's name is present in the 'unique' list:
    function addNodeName(nodeName) {
        // Have we seen this node before? Then there's nothing to do.
        if (uniqueNodes.has(nodeName)) { return; }
         // Set up the node's basic object, keyed to the name:
        uniqueNodes.set(nodeName, {
            name: nodeName,
            index: uniqueNodes.size,
        });
    }

    // updateNodeAttrs: Update an existing node's attributes.
    // Note: If there are multiple lines specifying a value for the same
    // parameter for a node, the LAST declaration will win.
    function updateNodeAttrs(nodeParams) {
        // Just in case this is the first appearance of the name, add it to
        // the big list:
        addNodeName(nodeParams.name);

        // If there's a color and it's a color CODE, put back the #:
        // TODO: honor or translate color names?
        if (nodeParams.color?.match(/[0-9A-F]{3,6}/i)) {
            nodeParams.color = `#${nodeParams.color}`;
        }

        Object.entries(nodeParams).forEach(([pName, pVal]) => {
            if (typeof pVal !== 'undefined'
                && pVal !== null && pVal !== "") {
                uniqueNodes.get(nodeParams.name)[pName] = pVal;
            }
        });
    }

    // parse into structures: approved_nodes, approved_flows, approved_config
    const sourceLines = el('flows_in').value.split("\n").map((l) => l.trim());

    // Loop through all the input lines, storing good ones vs bad ones:
    sourceLines.forEach((lineIn) => {
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
                paint1: matches[4],
                paint2: matches[5],
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
        include_values_in_node_labels: 0,
        show_labels: 1,
        label_pos: "auto",
        canvas_width: 600,
        canvas_height: 600,
        font_size: 15,
        font_weight: 400,
        top_margin: 18, right_margin: 12, bottom_margin: 20, left_margin: 12,
        default_flow_opacity: 0.45,
        default_node_opacity: 0.9,
        mention_sankeymatic: 1,
        node_width: 9,
        node_spacing: 24,
        node_border: 0,
        reverse_graph: 0,
        justify_origins: 0,
        justify_ends: 0,
        curvature: 0.5,
        default_flow_inherit: "outside_in",
        default_flow_color: "#666666",
        background_color: "#FFFFFF",
        background_transparent: 0,
        font_color: "#000000",
        default_node_color: "#006699",
        default_node_colorset: "C",
        font_face: "sans-serif",
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
    function explainSum(amount, flowList) {
        const formattedSum = withUnits(amount);
        if (flowList.length === 1) { return formattedSum; }

        // When there are multiple amounts, the amount appears as a hover
        // target with a tooltip showing the breakdown in descending order.
        const breakdown = flowList.map((f) => f.value)
                .sort((a, b) => b - a)
                .map((v) => withUnits(v))
                .join(' + ');
        return `<dfn title="${formattedSum} from ${flowList.length} `
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
        // console.log(fldName, fldVal, typeof fldVal);
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
        let flowColor = "",
            opacity = "",
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
        // Make sure the node names get saved; it may their only appearance:
        addNodeName(flow.source);
        addNodeName(flow.target);

        // Add the updated flow to the list of approved flows:
        const f = {
            source: uniqueNodes.get(flow.source).index,
            target: uniqueNodes.get(flow.target).index,
            value: flow.amount,
            color: flowColor,
            opacity: opacity,
        };
        if (graphIsReversed) {
            [f.source, f.target] = [f.target, f.source];
        }
        approvedFlows.push(f);
    });

    // Construct the final list of approved_nodes:
    // NOTE: We don't have to sort this for the indices to line up, since
    // .values() already gives us the items in insertion order.
    for (const nodeData of uniqueNodes.values()) {
        // Set up color inheritance signals.
        // 'Right' & 'left' here correspond to >> and <<.
        const paintLeft
                = (nodeData.paint1 === "<<" || nodeData.paint2 === "<<"),
            paintRight
                = (nodeData.paint1 === ">>" || nodeData.paint2 === ">>");
        // If the graph is reversed, the directions are swapped:
        nodeData.paint_right = graphIsReversed ? paintLeft : paintRight;
        nodeData.paint_left = graphIsReversed ? paintRight : paintLeft;
        // After establishing the above, the raw inputs aren't needed:
        delete nodeData.paint1;
        delete nodeData.paint2;

        approvedNodes.push(nodeData);
    }

    // Whole positive numbers:
    (["canvas_width", "canvas_height", "font_size",
        "top_margin", "right_margin", "bottom_margin",
        "left_margin", "font_weight", "node_spacing",
        "node_width", "node_border"]).forEach((fldName) => {
        const fldVal = el(fldName).value;
        if (fldVal.length < 10 && fldVal.match(/^\d+$/)) {
            approvedCfg[fldName] = Number(fldVal);
        } else {
            reset_field(fldName);
        }
    });

    // Vet the color theme offset fields:
    colorThemes.forEach((theme, themeKey) => {
        const fldName = `theme_${themeKey}_offset`,
              fldVal = el(fldName).value;
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

    (["default_flow_color", "background_color", "font_color",
        "default_node_color"]).forEach((fldName) => {
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
        makeDiagramBlank(approvedCfg);

        // Also clear out any leftover export output by rendering the
        // currently-blank canvas:
        glob.renderExportableOutputs();

        // No point in proceeding any further. Return to the browser:
        return null;
    }

    // Verify valid plain strings:
    (["unit_prefix", "unit_suffix"]).forEach((fldName) => {
        const fldVal = el(fldName).value;
        approvedCfg.numberStyle[fldName.slice(-6)]
            = (typeof fldVal !== 'undefined'
                && fldVal !== null
                && fldVal.length <= 10)
                ? fldVal
                : '';
    });

    // Interpret user's number format settings:
    (["number_format"]).forEach((fldName) => {
        const fldVal = el(fldName).value;
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
    // Allowed values = source|target|none
    let flowInherit = radioRef("default_flow_inherit").value;
    if (flowInherit.match(/^(?:source|target|outside_in|none)$/)) {
        if (graphIsReversed) {
            flowInherit
                = flowInherit === "source" ? "target"
                : flowInherit === "target" ? "source"
                : flowInherit;
        }
        approvedCfg.default_flow_inherit = flowInherit;
    } // otherwise skip & use the default

    const labelPosIn = radioRef("label_pos").value;
    if (labelPosIn.match(/^(?:all_left|auto|all_right)$/)) {
        approvedCfg.label_pos = labelPosIn;
    }

    const fontFaceIn = radioRef("font_face").value;
    if (fontFaceIn.match(/^(?:serif|sans-serif|monospace)$/)) {
        approvedCfg.font_face = fontFaceIn;
    }

    const colorsetIn = radioRef("default_node_colorset").value;
    if (colorsetIn.match(/^(?:[abcd]|none)$/)) {
        approvedCfg.default_node_colorset = colorsetIn;
        // Given the selected theme, what's the specific offset for that theme?
        approvedCfg.selected_theme_offset
            = colorsetIn === 'none'
            ? 0
            : approvedCfg[`theme_${colorsetIn}_offset`];
    }

    // Checkboxes:
    (["include_values_in_node_labels", "show_labels",
      "background_transparent", "justify_origins", "justify_ends",
      "mention_sankeymatic"]).forEach((fldName) => {
        approvedCfg[fldName] = el(fldName).checked;
    });

    // Decimal:
    (["default_node_opacity", "default_flow_opacity",
        "curvature"]).forEach((fldName) => {
        const fldVal = el(fldName).value;
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
    // totalIn/Out and value.
    approvedNodes.forEach((n, i) => {
        // Skip checking any nodes with 0 as the From or To amount; those are
        // the origins & endpoints for the whole graph and don't qualify:
        if (n.totalIn > 0 && n.totalOut > 0) {
            const difference = n.totalIn - n.totalOut;
            // Is there a difference big enough to matter? (i.e. > epsilon)
            // We'll always calculate this, even if not shown to the user.
            if (Math.abs(difference) > epsilonDifference) {
                differences.push({
                    name: n.name,
                    total_in: explainSum(n.totalIn, n.flowsIn),
                    total_out: explainSum(n.totalOut, n.flowsOut),
                    difference: withUnits(difference),
                });
            }
        } else {
            // Accumulate totals in & out of the graph
            // (On this path, one of these values will be 0 every time.)
            totalInflow += n.totalIn;
            totalOutflow += n.totalOut;
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
            "<tr><td></td><th>Total In</th><th>Total Out</th><th>Difference</th></tr>",
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
            `<table class="center_basic">${differenceRows.join("\n")}</table>`
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
        = parseFloat(el(`r${maxNodeIndex}`).getAttributeNS(null, "height")),
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
}(window === 'undefined' ? global : window));

// Make the linter happy about imported objects:
/* global d3, canvg, sampleDiagramRecipes, global */
