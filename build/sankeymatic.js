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

(function (glob) {
"use strict";
// 'glob' points to the global object, either 'window' (browser) or 'global' (node.js)
// This lets us contain everything in an IIFE (Immediately-Invoked Function Expression)

// el: shorthand for grabbing a DOM element:
function el(domId) { return document.getElementById(domId); }

// togglePanel: Called directly from the page.
// Given a panel's name, hide or show that control panel.
glob.togglePanel = panel => {
    const panel_el = el(panel),
        indicator_el = el( panel + '_indicator' ),
        hint_el      = el( panel + '_hint' ),
        hiding_now = ( panel_el.style.display !== 'none' );
    panel_el.style.display = hiding_now ? 'none'   : '';
    hint_el.innerHTML      = hiding_now ? '...'    : ':';
    indicator_el.innerHTML = hiding_now ? '+' : '&ndash;';
    return null;
};

// isNumeric: borrowed from jQuery/Angular
function isNumeric(n) { return !isNaN(n - parseFloat(n)); }

// clamp: Ensure a numeric value n is between min and max.
// Default to min if not numeric.
function clamp(n, min, max) {
    return isNumeric(n) ? Math.min(Math.max(n,min),max) : min;
}

// radioRef: get the object which lets you get/set a radio input value:
function radioRef(rId) { return document.forms['skm_form'].elements[rId]; }

// rememberedMoves: Used to track the user's repositioning of specific nodes
// (which should be preserved across diagram renders).
// Format is: nodeName => [move_x, move_y]
glob.rememberedMoves = new Map();

// resetMovesAndRender: Clear all manual moves of nodes AND re-render the
// diagram:
glob.resetMovesAndRender = function () {
    glob.rememberedMoves.clear();
    process_sankey();
    return null;
}

function updateResetNodesUI() {
    // Check whether we should enable the 'reset moved nodes' button:
    el('reset_all_moved_nodes').disabled =
        glob.rememberedMoves.size ? false : true;
}

// contrasting_gray_color:
// Given any hex color, return a grayscale color which is lower-contrast than
// pure black/white but still sufficient. (Used for less-important text.)
function contrasting_gray_color(hc) {
    const c = d3.rgb(hc),
        yiq = (c.r * 299 + c.g * 587 + c.b * 114)/1000,
        // Calculate a value sufficiently far away from this color.
        // If it's bright-ish, make a dark gray; if dark-ish, make a light gray.
        // This algorithm is far from exact! But it seems good enough.
        // Lowest/highest values produced are 59 and 241.
        gray = Math.floor(yiq > 164 ? (0.75 * yiq)-64 : (0.30 * yiq)+192);
    return d3.rgb(gray, gray, gray);
}

// escapeHTML: make any input string safe to display.
// Used for displaying raw <SVG> code
// and for reflecting the user's input back to them in messages.
function escapeHTML(unsafe_string) {
    return unsafe_string
         .replaceAll('→', "&#8594;")
         .replaceAll('&', "&amp;")
         .replaceAll('<', "&lt;")
         .replaceAll('>', "&gt;")
         .replaceAll('"', "&quot;")
         .replaceAll("'", "&#039;")
         .replaceAll("\n", "<br />");
}

// remove_zeroes: Strip off zeros from after any decimal
function remove_zeroes(number_string) {
    return number_string
        .replace( /(\.\d*?)0+$/, '$1' )
        .replace( /\.$/, '');  // If no digits remain, remove the '.' as well.
}

// ep = "Enough Precision". Why?
// SVG diagrams produced by SankeyMATIC don't really benefit from specifying
// values with more than 3 decimal places, but by default the output has *13*.
// This is frankly hard to read and actually inflates the size of the SVG output
// by quite a bit.
// Here, we explicitly round down to 5 digits (still more than we likely need).
//
// Result: values like 216.7614485930364 become 216.76145 instead.
// The 'Number .. toString' call allows shortened output: 8 instead of 8.00000
function ep(x) { return Number(x.toFixed(5)).toString(); }

// fix_separators: given a US-formatted number, replace with user's preferred separators:
function fix_separators(n, seps) {
    // If desired format is not the US default, perform hacky-but-functional swap:
    return ( seps.thousands !== ","
        // 3-step swap using ! as the placeholder:
        ? n.replace(/,/g, "!")
           .replace(/\./g, seps.decimal)
           .replace(/!/g, seps.thousands)
        : n );
}

// format_a_value: produce a fully prefixed, suffixed, & separated number for display:
function format_a_value(number_in, places, separators, prefix, suffix,
    display_full_precision) {
    let n = d3.format(`,.${places}f`)(number_in);
    if (!display_full_precision) { n = remove_zeroes(n); }
    return prefix + fix_separators(n, separators) + suffix;
}

// svg_background_class:
// Generate the class clause for the svg's background:
function svg_background_class(transparent) {
    return 'svg_background_' + (transparent ? 'transparent' : 'default');
}

// makeDiagramBlank: reset the SVG tag to be empty, with a pattern backing
// if the user wants it to be transparent:
function makeDiagramBlank(cfg) {
    // Simply emptying the SVG tag doesn't seem to work well in Safari,
    // so we remake the whole tag instead:
    el('chart').innerHTML =
        '<svg id="sankey_svg" xmlns="http://www.w3.org/2000/svg" version="1.1" '
        + `height="${cfg.canvas_height}" width="${cfg.canvas_width}" `
        + `class="${svg_background_class(cfg.background_transparent)}"></svg>`;
    return;
}

// render_png: Build a PNG file in the background
function render_png(curdate) {
    const chart_el = el('chart'),
        orig_w = chart_el.clientWidth,
        orig_h = chart_el.clientHeight,
        // What scale does the user want (1,2,4,6)?:
        scale_factor = clamp(el('scale_x').value,1,6),
        scaled_w = orig_w * scale_factor,
        scaled_h = orig_h * scale_factor,
        // Find the (hidden) canvas element in our page:
        canvas_el = el('png_preview'),
        // Set up the values Canvg will need:
        canvas_context = canvas_el.getContext("2d"),
        svg_el = el('sankey_svg'),
        svg_content = ( new XMLSerializer() ).serializeToString(svg_el),
        // More targets we'll be changing on the page:
        png_link_el = el('download_png_link'),
        // Generate yyyymmdd_hhmmss string:
        filename_timestamp =
            (curdate.toISOString().replace(/T.+$/,'_') +
             curdate.toTimeString().replace(/ .+$/,''))
            .replace(/[:-]/g,''),
        // Canvg 3 needs interesting offsets added when scaling up:
        x_offset = (scaled_w - orig_w) / (2 * scale_factor),
        y_offset = (scaled_h - orig_h) / (2 * scale_factor);

    // Set the canvas element to the final height/width the user wants:
    canvas_el.width = scaled_w;
    canvas_el.height = scaled_h;

    // Update img tag hint with user's original dimensions:
    el('img_tag_hint_w').innerHTML = orig_w;
    el('img_tag_hint_h').innerHTML = orig_h;

    // Give Canvg what it needs to produce a rendered image:
    const canvg_obj = canvg.Canvg.fromString(
        canvas_context,
        svg_content, {
            ignoreMouse: true,
            ignoreAnimation: true,
            ignoreDimensions: true, // DON'T make the canvas size match the svg
            scaleWidth: scaled_w,
            scaleHeight: scaled_h,
            offsetX: x_offset,
            offsetY: y_offset
        });
    canvg_obj.render();

    // Convert canvas image to a URL-encoded PNG and update the link:
    png_link_el.setAttribute( "href", canvas_el.toDataURL('image/png') );
    png_link_el.setAttribute( "target", "_blank" );

    // update download link & filename with dimensions:
    png_link_el.innerHTML = `Export ${scaled_w} x ${scaled_h} PNG`;
    png_link_el.setAttribute( "download",
        `sankeymatic_${filename_timestamp}_${scaled_w}x${scaled_h}.png` );

    return;
}

// produce_svg_code: take the current state of 'sankey_svg' and
// relay it nicely to the user
function produce_svg_code(curdate) {
  // For the user-consumable SVG code, make a copy of the real SVG & put in a
  // title placeholder & credit:
  const svg_for_copying =
      // Read the live SVG structure and tweak it:
      el('chart').innerHTML
        // Take out the id and the class declaration for the background:
        .replace(' id="sankey_svg"', '')
        .replace(/ class="svg_background_[a-z]+"/, '')
        // Insert some helpful tags in front of the first inner tag:
        .replace(/>/,
          ">\n<title>Your Diagram Title</title>\n" +
          `<!-- Generated with SankeyMATIC: ${curdate.toLocaleString()} -->\n`)
        // Add some line breaks to highlight where [g]roups start/end
        // and where each [path] and [text] start:
        .replace(/<(g|\/g|path|text)/g, "\n<$1");

  // Escape that whole batch of tags and put it in the <div> for copying:
  el('svg_for_export').innerHTML = escapeHTML(svg_for_copying);

  return;
}

// Pure functions for generating SVG path specs:
// CURVED path function generator:
// Returns a /function/ specific to the user's curvature choice.
// Used for the "d" attribute on a "path" element when curvature > 0
function curvedFlowPathFunction(curvature) {
    return function(f) {
        const xs = f.source.x + f.source.dx,  // source's trailing edge
            xt = f.target.x,                  // target's leading edge
            ysc = f.source.y + f.sy + f.dy/2, // source flow center
            ytc = f.target.y + f.ty + f.dy/2, // target flow center
            // Set up a function for interpolating between the two x values:
            xinterpolate = d3.interpolateNumber(xs, xt),
            // Pick 2 curve control points given the curvature & its converse:
            xc1 = xinterpolate(curvature),
            xc2 = xinterpolate(1 - curvature);
        // This SVG Path spec means:
        // [M]ove to the center of the flow's start
        // Draw a Bezier [C]urve using control points (xc1,ysc) + (xc2,ytc)
        // End at the center of the flow's target
        return `M${ep(xs)} ${ep(ysc)}C${ep(xc1)} ${ep(ysc)}`
            + ` ${ep(xc2)} ${ep(ytc)} ${ep(xt)} ${ep(ytc)}`;
    }
}

// FLAT path function:
// Used for the "d" attribute on a "path" element when curvature = 0
function flatFlowPathMaker(f) {
    const xs = f.source.x + f.source.dx,   // source's trailing edge
        xt = f.target.x,                   // target's leading edge
        ys_top = f.source.y + f.sy,        // source flow top
        yt_bot = f.target.y + f.ty + f.dy; // target flow bottom
    // This SVG Path spec means:
    // [M]ove to the flow source's top; draw a [v]ertical line down,
    // a [L]ine to the opposite corner, a [v]ertical line up, then [z] close.
    return `M${ep(xs)} ${ep(ys_top)}v${ep(f.dy)}`
        + `L${ep(xt)} ${ep(yt_bot)}v-${ep(f.dy)}z`;
}

// renderExportableOutputs: Called directly from the page (and from below).
// Kick off a re-render of the static image and the user-copyable SVG code.
// Used after each draw & when the user chooses a new PNG resolution.
glob.renderExportableOutputs = function () {
    // Reset the existing export output areas:
    const png_link_el = el('download_png_link'),
        current_date = new Date();

    // Clear out the old image link, cue user that the graphic isn't yet ready:
    png_link_el.innerHTML = '...creating downloadable graphic...';
    png_link_el.setAttribute( 'href', '#' );

    // Wipe out the SVG from the old diagram:
    el('svg_for_export').innerHTML = '(generating SVG code...)';

    // Fire off asynchronous events for generating the export output,
    // so we can give control back asap:
    setTimeout( render_png(current_date), 0 );
    setTimeout( produce_svg_code(current_date), 0 );

    return null;
};

// hideReplaceGraphWarning: Called directly from the page (and from below)
// Dismiss the note about overwriting the user's current inputs.
glob.hideReplaceGraphWarning = function () {
    // Hide the overwrite-warning paragraph (if it's showing)
    el('replace_graph_warning').style.display = "none";
    return null;
}

// replaceGraphConfirmed: Called directly from the page (and from below).
// It's ok to overwrite the user's inputs now. Let's go.
// (Note: In order to reach this code, we have to have already verified the
// presence of the named recipe, so we don't re-verify.)
glob.replaceGraphConfirmed = function () {
    const graphName = el('demo_graph_chosen').value,
        savedRecipe = sampleDiagramRecipes.get(graphName);

    // Update any settings which accompany the stored diagram:
    Object.entries(savedRecipe.settings).forEach( ([fld, newVal]) => {
        if (typeof newVal === 'boolean') { // boolean => radio or checkbox
            el(fld).checked = newVal;
        } else { // non-boolean => an ordinary value to set
            el(fld).value = newVal;
        }
    });

    // Select all the existing input text...
    const flows_el = el('flows_in')
    flows_el.focus();
    flows_el.select();
    // ... then replace it with the new content.
    flows_el.setRangeText(savedRecipe.flows, 0, flows_el.selectionEnd,
        'start');

    // Un-focus the input field (on tablets, this keeps the keyboard from
    // auto-popping-up):
    flows_el.blur();

    // If the replace-graph warning is showing, hide it:
    glob.hideReplaceGraphWarning();

    // Take away any remembered moves (just in case any share a name with a
    // node in the new diagram) & immediately draw the new diagram::
    glob.resetMovesAndRender();
    return null;
}

// replaceGraph: Called directly from the page.
// User clicked a button which may cause their work to be erased.
// Run some checks before we commit...
glob.replaceGraph = function (graphName) {
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
            .some(r => r.flows == userInputs);

    if (inputsMatchAnySample || userInputs === '') {
        // The user has NOT changed the input from one of the samples,
        // or the whole field is blank. Go ahead with the change:
        glob.replaceGraphConfirmed();
    } else {
        // Show the warning and do NOT replace the graph:
        el('replace_graph_warning').style.display = "";
        el('replace_graph_yes').innerHTML =
            `Yes, replace the graph with '${savedRecipe.name}'`;
    }

    return null;
};

// colorThemes: The available color arrays to assign to Nodes.
const colorThemes = new Map([
    ['a', { colorset: d3.schemeCategory10,
        nickname: 'Categories',
        d3Name:   'Category10' }],
    ['b', { colorset: d3.schemeTableau10,
        nickname: 'Tableau10',
        d3Name:   'Tableau10' }],
    ['c', { colorset: d3.schemeDark2,
        nickname: 'Dark',
        d3Name:   'Dark2' }],
    ['d', { colorset: d3.schemeSet3,
        nickname: 'Varied',
        d3Name:   'Set3', }],
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
glob.nudgeColorTheme = function(themeKey, move) {
    const themeOffset_el = el(`theme_${themeKey}_offset`),
        currentOffset = (themeOffset_el === null) ? 0 : themeOffset_el.value,
        colorsInTheme = approvedColorTheme(themeKey).colorset.length,
        newOffset = (colorsInTheme + +currentOffset + +move) % colorsInTheme;

    // Update the stored offset with the new value (0 .. last color):
    themeOffset_el.value = newOffset;

    // If the theme the user is updating is not the active one, switch to it:
    el(`theme_${themeKey}_radio`).checked = true;

    process_sankey();
    return null;
}

// render_sankey: given nodes, flows, and other config, MAKE THE SVG DIAGRAM:
function render_sankey(all_nodes, all_flows, cfg) {
    let graph_w, graph_h, sankey_obj, d3_color_scale_fn,
        flow_path_fn, // holds the path-generating function
        diag_main,    // primary d3 selection of the graph
        diag_flows,   // d3 selection of all flow paths
        diag_nodes,   // ...all nodes
        diag_labels,  // ...all labels & titles
        stagesArr = []; // the array of all stages in the diagram
        // Drawing curves with curvature of <= 0.1 looks bad and produces visual
        // artifacts, so let's just take the lowest value on the slider (0.1)
        // and call that 0/flat:
    const flat_flows = (cfg.curvature <= 0.1);

    // units_format: produce a fully prefixed/suffixed/separated number string:
    function units_format(n) {
        return format_a_value(n,
            cfg.max_places, cfg.seps,
            cfg.unit_prefix, cfg.unit_suffix,
            cfg.display_full_precision);
    }

    // flow_path_fn is a function returning coordinates and specs for each flow
    // The function when flows are flat is different from the curve function.
    flow_path_fn = flat_flows
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
            : f.source.inherit_right ? f.source.color
            : f.target.inherit_left ? f.target.color
            : cfg.default_flow_inherit === 'source' ? f.source.color
            : cfg.default_flow_inherit === 'target' ? f.target.color
            : cfg.default_flow_inherit === 'outside_in' ?
              // Is the midpoint of the flow in the right half, or left?
              // (If it's in the exact middle, we use the source color.)
              ((f.source.stage + f.target.stage)/2 <= (stagesArr.length - 1)/2
                ? f.source.color
                : f.target.color)
            : cfg.default_flow_color;
    }

    // What is the normal opacity for a flow?
    function flow_normal_opacity(f) {
        return f.opacity || cfg.default_flow_opacity;
    }

    // What is the opacity when a user hovers over this flow?
    function flow_hover_opacity(f) {
        return f.opacity_on_hover ||
            ( Number(cfg.default_flow_opacity) + 1 ) / 2;
    }

    // Establish a list of compatible colors to choose from:
    if (cfg.default_node_colorset === "none") {
        // Make a color array with just the one value:
        d3_color_scale_fn = d3.scaleOrdinal([cfg.default_node_color]);
    } else {
        const theme = approvedColorTheme(cfg.default_node_colorset);
        d3_color_scale_fn = d3.scaleOrdinal(
            rotateColors(theme.colorset, cfg.selected_theme_offset)
        );
    }

    // Fill in any un-set node colors up front so flows can inherit colors
    // from them:
    all_nodes.forEach( function(node) {
        if (typeof node.color === 'undefined' || node.color === '') {
            // Use the first non-blank string in the label as the basis for
            // adopting an already-used color or picking a new one. (Note:
            // case sensitive!) If there are no non-blank strings in the node
            // name, substitute a word-ish value (rather than crash):
            const first_word =
                ( /^\s*(\S+)/.exec(node.name) || ['','name-is-blank'] )[1];
            node.color = d3_color_scale_fn(first_word);
        }
    });

    // At this point, all_nodes and all_flows are ready to go.

    // Set the dimensions of the space:
    // (This will get much more complicated once we start auto-fitting labels.)
    graph_w = cfg.canvas_width - cfg.left_margin - cfg.right_margin;
    graph_h = cfg.canvas_height - cfg.top_margin - cfg.bottom_margin;

    // Create the sankey object & its properties.
    // NOTE: This will further MODIFY the all_nodes and all_flows objects,
    // filling in specifics about layout positions, etc.
    sankey_obj = d3.sankey()
        .nodeWidth(cfg.node_width)
        .nodeSpacingFactor(cfg.node_spacing/100)
        .size([graph_w, graph_h])
        .nodes(all_nodes)
        .flows(all_flows)
        .rightJustifyEndpoints(cfg.justify_ends)
        .leftJustifyOrigins(cfg.justify_origins)
        .setup();

    sankey_obj.layout(50); // Note: The 'layout()' step must be LAST.

    // Get the final stages array (might be used for outside-in colors):
    stagesArr = sankey_obj.stages();

    // Draw!

    // Clear out any old contents:
    makeDiagramBlank(cfg);

    // Select the svg canvas, set the defined dimensions:
    diag_main = d3.select("#sankey_svg")
        .attr("height", cfg.canvas_height)
        .attr("width", cfg.canvas_width)
        .attr("class", svg_background_class(cfg.background_transparent));

    // If a background color is defined, add a backing rectangle with that color:
    if (cfg.background_transparent != 1) {
        // Note: This just adds the rectangle *without* changing the d3
        // selection stored in diag_main:
        diag_main.append("rect")
            .attr("height", cfg.canvas_height)
            .attr("width", cfg.canvas_width)
            .attr("fill", cfg.background_color);
    }

    // Add a [g]roup which moves the remaining diagram inward based on the
    // user's margins.
    // d3 hint: We update the diag_main selection with the result here because
    // all of the rest of the additions to the SVG will be contained *inside*
    // this group.
    diag_main = diag_main.append("g")
        .attr("transform", `translate(${cfg.left_margin},${cfg.top_margin})`);

    // Set up the [g]roup of rendered flows:
    diag_flows = diag_main.append("g")
        .attr("id","sankey_flows")
      .selectAll(".link")
      .data(all_flows)
      .enter()
      .append("path")
        .attr("class", "link")
        .attr("d", flow_path_fn) // set the SVG path for each flow
        .style("stroke", d => flow_final_color(d))
        .style("opacity", d => flow_normal_opacity(d))
      // add emphasis-on-hover behavior:
      .on('mouseover', function(d){
          d3.select(this).style( "opacity", flow_hover_opacity(d));
          })
      .on('mouseout', function(d){
          d3.select(this).style( "opacity", flow_normal_opacity(d));
          })
      // Sort flows to be rendered from largest to smallest
      // (so if flows cross, the smaller are drawn on top of the larger):
      .sort(function (a, b) { return b.dy - a.dy; });

    if (flat_flows) {
        // When flows have no curvature at all, they're really parallelograms.
        // The fill is the main source of color then:
        diag_flows.style("fill", d => flow_final_color(d))
            // We add a little bit of a stroke because the outermost flows look
            // overly thin otherwise. (They still can, even with this addition.)
           .style("stroke-width", 0.5);
    } else {
        // When curved, there is no fill, only stroke-width:
        diag_flows.style("fill", "none")
            // Make sure any flow, no matter how small, is visible (1px wide):
            .style("stroke-width", d => ep(Math.max(1, d.dy)));
    }

    // Add a tooltip for each flow:
    diag_flows.append("title")
        .text(function (d) {
            return `${d.source.name} → ${d.target.name}:\n${units_format(d.value)}`;
        });

    // Given a Node index, apply its move to the SVG & remember it for later:
    function applyNodeMove(index) {
        const n = all_nodes[index],
            graphIsReversed = el('reverse_graph').checked,
            // In the case of a reversed graph, we negate the x-move:
            my_move_x = n.move[0] * (graphIsReversed ? -1 : 1),
            available_w = graph_w - n.dx,
            available_h = graph_h - n.dy;

        // Apply the move to the node (halting at the edges of the graph):
        n.x = Math.max(0,
            Math.min(available_w, n.origPos.x + available_w * my_move_x));
        n.y = Math.max(0,
            Math.min(available_h, n.origPos.y + available_h * n.move[1]));

        // Find everything which shares the class of the dragged node and
        // translate each with these offsets.
        // Currently this means the node and its label, if present.
        // (Why would we apply a null transform? Because it may have been
        // transformed already & we are now undoing the previous operation.)
        d3.selectAll(`#sankey_svg .for_r${index}`)
            .attr("transform", (n.move == [0, 0])
                ? null
                : `translate(${ep(n.x - n.origPos.x)},${ep(n.y - n.origPos.y)})`
                );
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

        if (n.move == [0, 0]) {
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
        sankey_obj.relayout();

        // For every flow, update its 'd' path attribute with the new
        // calculated path:
        diag_flows.attr("d", flow_path_fn);

        // Regenerate the exportable versions:
        glob.renderExportableOutputs();
    }

    // Show helpful guides/content for the current drag. We put it all in a
    // distinct 'g'roup for helper content so we can remove it easily later:
    function dragNodeStarted(event, d) {
        const grayColor = contrasting_gray_color(cfg.background_color);
        let diag_helper_layer = diag_main.select("#helper_layer");
        // Create the helper layer if it doesn't exist:
        if (diag_helper_layer.nodes.length == 0) {
            // Insert it just before (i.e. 'under') the 'nodes' layer, so it
            // doesn't interfere with things like double-clicks on nodes.
            diag_helper_layer = diag_main.insert("g","#sankey_nodes")
              .attr("id","helper_layer")
              // Set up attributes common to all the stuff inside here..
              .style("fill", grayColor)
              .style("fill-opacity", 0.5)
              .style("stroke", "none");
        }

        // Draw 4 horizontal/vertical guide lines, along the edges of the
        // place where the drag began (d.lastPos):
        diag_helper_layer.append("path")
          .attr("id","helper_lines")
          // This SVG Path spec means:
          // [M]ove to the left edge of the graph at this node's top
          // [h]orizontal line across the whole graph width
          // [m]ove down by this node's height
          // [H]orizontal line back to the left edge (x=0)
          // ..Then the same operation [v]ertically, using this node's width.
          .attr("d", `M0 ${ep(d.lastPos.y)} h${ep(graph_w)} m0 ${ep(d.dy)} H0`
                   + `M${ep(d.lastPos.x)} 0 v${ep(graph_h)} m${ep(d.dx)} 0 V0`)
          .style("stroke", grayColor)
          .style("stroke-width", 1)
          .style("stroke-dasharray", "1 3")
          .style("stroke-opacity", 0.7);

        // Put a ghost rectangle where this node started out:
        diag_helper_layer.append("rect")
          .attr("id","helper_original_rect")
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
            const shift_hints = diag_helper_layer.append("g")
              .attr("id","helper_shift_hints")
              .style("font-size", "14px")
              .style("font-weight", "400")
            const hint_placement_heights = graph_h > 350
                ? [0.05, 0.95]
                : [0.4];
            // Show the text so it's visible but not overwhelming:
            hint_placement_heights.forEach( h => {
                shift_hints.append("text")
                  .attr("text-anchor", "middle")
                  .attr("x", graph_w/2)
                  .attr("y", graph_h * h)
                 .text("Hold down Shift to move in only one direction");
            });
        }
        return null;
    }

    // This is called _during_ Node drags:
    function draggingNode(event, d) {
        // Fun fact: In this context, event.subject is the same thing as 'd'.
        let my_x = event.x,
            my_y = event.y,
            graphIsReversed = el('reverse_graph').checked;

        // Check for the Shift key:
        if (event.sourceEvent && event.sourceEvent.shiftKey) {
            // Shift is pressed, so this is a constrained drag.
            // Figure out which direction the user has dragged _further_ in:
            if (Math.abs(my_x - d.lastPos.x) > Math.abs(my_y - d.lastPos.y)) {
                my_y = d.lastPos.y; // Use X move; keep Y constant
            } else {
                my_x = d.lastPos.x; // Use Y move; keep X constant
            }
            // If they've Shift-dragged, they don't need the hint any more -
            // remove it and don't bring it back until the next gesture.
            const shift_hint = diag_main.select("#helper_shift_hints");
            if (shift_hint.nodes) { shift_hint.remove(); }
        }

        // Calculate the percentages we want to save (which will stay
        // independent of the graph's edge constraints, even if the spacing,
        // etc. changes):
        d.move = [
            // If the graph is RTL, calculate the x-move as though it is LTR:
            (my_x - d.origPos.x)/(graph_w - d.dx) * (graphIsReversed ? -1 : 1),
            (graph_h == d.dy) ? 0 : (my_y - d.origPos.y)/(graph_h - d.dy)
        ];

        applyNodeMove(d.index);
        // We don't rememberNodeMove after every pixel-move of a drag; just
        // when a gesture is finished.
        reLayoutDiagram();
        return null;
    }

    // (Investigate: This is called on every ordinary *click* as well; look
    // into skipping this work if no actual move has happened.)
    function dragNodeEnded(event, d) {
        // Take away the helper guides:
        const helper_layer = diag_main.select("#helper_layer");
        if (helper_layer.nodes) { helper_layer.remove(); }

        // After a drag is finished, any new constrained drag should use the
        // _new_ position as 'home'. Therefore we have to set this as the
        // 'last' position:
        rememberNodeMove(d);
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
    diag_nodes = diag_main.append("g")
        .attr("id", "sankey_nodes")
        .attr("shape-rendering", "crispEdges")
        .style("stroke-width", cfg.node_border || 0)
      .selectAll(".node")
      .data(all_nodes)
      .enter()
      .append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragNodeStarted)
            .on("drag", draggingNode)
            .on("end", dragNodeEnded))
        .on("dblclick", doubleClickNode);

    // Construct the actual rectangles for NODEs:
    diag_nodes.append("rect")
        .attr("x", d => ep(d.x))
        .attr("y", d => ep(d.y))
        .attr("height", d => ep(d.dy))
        .attr("width", cfg.node_width)
        // Give a unique ID & class to each rect that we can reference:
        .attr("id", d => "r" + d.index)
        .attr("class", d => "for_r" + d.index)
        // we made sure above there will be a color defined:
        .style("fill", d => d.color)
        .style("fill-opacity", d => d.opacity || cfg.default_node_opacity)
        .style("stroke", d => d3.rgb(d.color).darker(2))
      // Add tooltips showing node totals:
      .append("title")
        .text(function (d) {
            return `${d.name}:\n${units_format(d.value)}`;
        });

    diag_labels = diag_main.append("g")
        .attr("id","sankey_labels")
        // These font spec defaults apply to all labels within
        .style("font-family", cfg.font_face)
        .style("font-size", cfg.font_size + "px")
        .style("font-weight", cfg.font_weight)
        .style("fill", cfg.font_color);
    if (cfg.mention_sankeymatic) {
        diag_labels.append("text")
            // Anchor the text to the midpoint of the canvas (not the graph):
            .attr("text-anchor", "middle")
            // x = graph_w/2 is wrong when the L/R margins are uneven.. We
            // have to use the whole width & adjust for the graph's transform:
            .attr("x", cfg.canvas_width/2 - cfg.left_margin)
            .attr("y", graph_h + cfg.bottom_margin - 5)
            // Keep the current font, but make this small & grey:
            .style("font-size", "11px")
            .style("font-weight", "400")
            .style("fill", contrasting_gray_color(cfg.background_color))
            .text("Made with SankeyMATIC");
    }

    if ( cfg.show_labels ) {
        // Add labels in a distinct layer on the top (so nodes can't block them)
        diag_labels.selectAll()
          .data(all_nodes)
          .enter()
          .append("text")
            // Anchor the text to the left, ending at the node:
            .attr("text-anchor", "end")
            .attr("x", d => ep(d.x + -6))
            .attr("y", d => ep(d.y + d.dy/2))
            // Move letters down by 1/3 of a wide letter's width
            // (makes them look vertically centered)
            .attr("dy",".35em")
            // Associate this label with its node:
            .attr("class", d => "for_r" + d.index)
            .text(d => d.name
                        + ( cfg.include_values_in_node_labels
                            ? ": " + units_format(d.value)
                            : "" ))
          // Move the labels, potentially:
          .filter(
            // (filter = If this function returns TRUE, then the lines
            // after this step are executed.)
            // Check if this label should be right-of-node instead:
            function (d) {
                // First, has the user set a simple rule for all?
                return cfg.label_pos === "all_left"  ? 0
                    :  cfg.label_pos === "all_right" ? 1
                    // Otherwise: if the node's x-coordinate is in the
                    // left half of the graph, relocate the label to
                    // appear to the RIGHT of the node.
                    // (Here x is nudged by a node_width to make the
                    // *exact* middle of the diagram have left labels:
                    :  (( d.x + cfg.node_width ) < ( graph_w / 2 ));
            })
            // Here is where the label is actually moved to the right:
            .attr("text-anchor", "start")
            .attr("x", d => ep(d.x + cfg.node_width + 6));
    }

    // Now that all of the SVG nodes and labels exist, it's time to re-apply
    // any remembered moves:
    if (glob.rememberedMoves.size) {
        // Make a copy of the list of moved-Node names (so we can destroy it):
        const movedNodes = new Set(glob.rememberedMoves.keys());

        // Look for all node objects matching a name in the list:
        all_nodes.filter( n => movedNodes.has(n.name) )
            .forEach( n => {
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
        movedNodes.forEach( nodeName => {
            glob.rememberedMoves.delete(nodeName);
        });

        // Re-layout the diagram once, after all of the above moves:
        reLayoutDiagram();
    }

} // end of render_sankey

// MAIN FUNCTION:
// process_sankey: Called directly from the page and within this script.
// Gather inputs from user; validate them; render updated diagram
glob.process_sankey = function () {
    let source_lines = [], good_flows = [], good_node_lines = [],
        bad_lines = [], node_order = [], line_ix = 0, line_in = '',
        unique_nodes = {}, matches = [],
        approved_nodes = [], approved_flows = [], approved_config = {},
        total_inflow = 0, total_outflow = 0, max_places = 0,
        epsilon_difference = 0, status_message = '',
        max_node_index = 0, max_node_val = 0, flow_inherit = '',
        colorset_in = '', labelpos_in = '', fontface_in = '',
        differences = [];
    const differences_el = el('imbalances'),
        list_differences_el = el('flow_cross_check'),
        chart_el    = el('chart'),
        messages_el = el('top_messages_container'),
        graphIsReversed = el('reverse_graph').checked;

    // Define utility functions:

    // addMsgAbove: Put a message above the chart using the given class:
    function addMsgAbove(msgHTML, msgClass, msgGoesFirst) {
        const newMsg = `<div class="${msgClass}">${msgHTML}</div>`;
        messages_el.innerHTML = msgGoesFirst
            ? (newMsg + messages_el.innerHTML)
            : (messages_el.innerHTML + newMsg);
    }

    function setTotalsMsg(msgHTML) {
        el('messages_container').innerHTML = `<div>${msgHTML}</div>`;
    }

    function setDifferencesMsg(msgHTML) {
        el('imbalance_messages').innerHTML =
            msgHTML.length ? `<div id="imbalance_msg">${msgHTML}</div>`: '';
    }

    // unit_fy: Format a value as it will be in the graph.
    // Uses approved_config and max_places (or a separately submitted
    // 'places' param)
    function unit_fy(number_in, places) {
        return format_a_value(number_in,
            ( places || max_places ), approved_config.seps,
            approved_config.unit_prefix, approved_config.unit_suffix,
            approved_config.display_full_precision);
    }

    // explainSum: Returns an html string showing the flow amounts which
    // add up to a node's total value in or out.
    function explainSum(amount, flowList) {
        const formatted_sum = unit_fy(amount);
        if (flowList.length === 1) { return formatted_sum; }

        // When there are multiple amounts, the amount appears as a hover
        // target with a tooltip showing the breakdown in descending order.
        const breakdown = flowList.map(f => f.value)
                .sort((a,b) => b - a)
                .map(v => unit_fy(v))
                .join(' + ');
        return `<dfn title="${formatted_sum} from ${flowList.length} `
            + `Flows: ${breakdown}">${formatted_sum}</dfn>`;
    }

    // Update the display of all known themes given their offsets:
    function updateColorThemeDisplay() {
        // template string for the color swatches:
        const makeSpanTag = (color, count, themeName) =>
            `<span style="background-color: ${color};" `
            + `class="color_sample_${count}" `
            + `title="${color} from d3 color scheme ${themeName}">`
            + `&nbsp;</span>`;
        for (const t of colorThemes.keys()) {
            const theme = approvedColorTheme(t),
                themeOffset = el(`theme_${t}_offset`).value,
                colorset = rotateColors(theme.colorset, themeOffset),
                // Show the array rotated properly given the offset:
                renderedGuide = colorset
                    .map(c => makeSpanTag(c, colorset.length, theme.d3Name))
                    .join('');
                // SOMEDAY: Add an indicator for which colors are/are not
                // in use?
            el(`theme_${t}_guide`).innerHTML = renderedGuide;
            el(`theme_${t}_label`).textContent = theme.nickname;
        }
    }

    // BEGIN by resetting all messages:
    messages_el.innerHTML = '';

    // Go through lots of validation with plenty of bailout points and
    // informative messages for the poor soul trying to do this.

    // MARK: UI updates based on user choices:

    // Checking the 'Transparent' background-color box *no longer* means that
    // the color-picker is pointless; it still affects the color value which
    // will be given to "Made with SankeyMATIC".
    // Therefore, we no longer disable the Background Color element, even when
    // 'Transparent' is checked.

    // If the user is setting Label positions to either left or right (i.e. not
    // 'auto'), show the margin hint:
    const label_pos_val = radioRef("label_pos").value;
    el('label_pos_note').innerHTML =
        (label_pos_val === "all_left"
       ? "Adjust the <strong>Left Margin</strong> above to fit your labels"
       : label_pos_val === "all_right"
       ? "Adjust the <strong>Right Margin</strong> above to fit your labels"
       : "");

    // Flows validation:

    // parse into structures: approved_nodes, approved_flows, approved_config
    source_lines = el('flows_in').value.split("\n");

    // parse all the input lines, storing good ones vs bad ones:
    for ( line_ix = 0; line_ix < source_lines.length; line_ix += 1 ) {
        // Does this line match the basic format?
        line_in = source_lines[line_ix].trim();
        // Is it a comment? Skip it entirely:
        // Currently comments can start with ' or // :
        if ( line_in.match(/^'/) || line_in.match(/^\/\//) ) {
            continue;
        }
        // Try to match the line to a Node spec:
        matches = line_in.match(
                /^:(.+)\ #([0-9A-F]{0,6})?(\.\d{1,4})?\s*(>>|<<)*\s*(>>|<<)*$/i );
        if ( matches !== null ) {
            good_node_lines.push(
                { name:     matches[1].trim(),
                  color:    matches[2],
                  opacity:  matches[3],
                  inherit1: matches[4],
                  inherit2: matches[5]
                } );
            // No need to process this as a Data line, let's move on:
            continue;
        }

        // Try to match the line to a Data spec:
        matches = line_in.match( /^(.+)\[([\d\.\s\+\-]+)\](.+)$/ );
        if ( matches !== null ) {
            // The Amount looked trivially like a number; reject the line
            // if it really isn't:
            const amount_in = matches[2].replace(/\s/g,'');
            if ( !isNumeric(amount_in) ) {
                bad_lines.push (
                    { value: line_in,
                      message: 'The Amount is not a valid decimal number.' } );
            // The Sankey library doesn't currently support negative numbers or 0:
            } else if (amount_in <= 0) {
                bad_lines.push (
                    { value: line_in,
                      message: 'Amounts must be greater than 0.' } );
            } else {
                // All seems well, save it as good (even if 0):
                good_flows.push(
                    { source: matches[1].trim(),
                      target: matches[3].trim(),
                      amount: amount_in } );
                // We need to know the maximum precision of the inputs (greatest
                // # of characters to the RIGHT of the decimal) for some error
                // checking operations (& display) later:
                max_places =
                    Math.max( max_places,
                        ( ( amount_in.split( /\./ ) )[1] || '' ).length );
            }
        // Did something make the input not match the pattern?:
        } else if ( line_in !== '' ) {
            bad_lines.push(
                { value: line_in,
                  message:
                    'Does not match the format of a Flow or a Node.' }
            );
        }
        // and the final 'else' case is: a blank line.
        // We just skip those silently, so you can separate your input lines with
        // whitespace if desired.
    }

    // TODO: Disable useless precision checkbox if max_places === 0
    // TODO: Look for cycles and post errors about them

    // Mention any un-parseable lines:
    bad_lines.forEach( parsingError => {
        addMsgAbove(
            '&quot;<b>' + escapeHTML(parsingError.value) + '</b>&quot;: ' +
              parsingError.message,
            'errormessage', false );
    });

    // Set up some data & functions that only matter from this point on:

    // approved_config begins with all the default values defined.
    // Values the user enters will override these (if present & valid).
    approved_config = {
        unit_prefix: "",
        unit_suffix: "",
        number_format: ",.",
        seps: { thousands: ",", decimal: "." },
        max_places: max_places,
        display_full_precision: 1,
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
        background_color:   "#FFFFFF",
        background_transparent: 0,
        font_color:         "#000000",
        default_node_color: "#006699",
        default_node_colorset: "C",
        font_face: "sans-serif",
        selected_theme_offset: 0,
        theme_a_offset: 7, theme_b_offset: 0,
        theme_c_offset: 0, theme_d_offset: 0
    };

    // save_node: Add (or update) a node in the 'unique' list:
    function save_node( nodename, nodeparams ) {
        // Have we NOT seen this node before? Then add it:
        if ( !unique_nodes.hasOwnProperty(nodename) ) {
            // establish the hash:
            unique_nodes[nodename] = {
                index: node_order.length
            };
            node_order.push(nodename);
        }
        // Even if we have seen a node, there still may be more parameters
        // to add to its spec:
        if ( typeof nodeparams === "object" ) {
            Object.keys(nodeparams).forEach( function(p) {
                // console.log(nodename, p,
                //    unique_nodes[nodename].hasOwnProperty(p) );
                if ( nodeparams[p] !== null && nodeparams[p] !== "" ) {
                    // Note: If there are multiple lines specifying a value for
                    // the same parameter for a node, the last one will win:
                    unique_nodes[nodename][p] = nodeparams[p];
                }
            } );
        }
    }

    // reset_field: We got bad input, so reset the form field to the default value
    function reset_field(field_name) {
        el(field_name).value = approved_config[field_name];
    }

    // get_color_input: If a field has a valid-looking HTML color value, then use it
    function get_color_input( field_name ) {
        let field_el  = el(field_name),
            field_val = field_el.value;
        // console.log(field_name, field_val, typeof field_val);
        if ( field_val.match( /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i ) ) {
            approved_config[field_name] = field_val;
        } else if ( field_val.match( /^(?:[a-f0-9]{3}|[a-f0-9]{6})$/i ) ) {
            // Forgive colors with missing #:
            field_val = '#' + field_val;
            approved_config[field_name] = field_val;
            field_el.value = field_val;
        } else {
            reset_field(field_name);
        }
    }

    // First go through the Node list and set up any extra parameters we have:
    good_node_lines.forEach( function(node) {
        // If there's a color and it's a color CODE, put back the #:
        // TODO: honor or translate color names?
        if ( node.color && node.color.match( /[0-9A-F]{3,6}/i ) ) {
            node.color = '#' + node.color;
        }
        save_node( node.name, node );
    } );

    // Given good_flows, make the lists of nodes and flows
    good_flows.forEach( function(flow) {
        // Look for extra content about this flow on the target-node end of the
        // string:
        let possible_color, possible_nodename, flow_color = "",
            opacity = "", opacity_on_hover = "";
        // Try to parse; there may be extra info that isn't actually the name:
        // Format of the Target node can be:
        // TODO: Target node ["Custom name for flow"] [#color[.opacity]]
        // e.g. Clinton #CCDDEE
        // e.g. Gondor "Legolas" #998877.25
        // Look for an additional string starting with # for color info
        matches = flow.target.match( /^(.+)\s+(#\S+)$/ );
        if ( matches !== null ) {
            // IFF the # string matches the pattern, separate the nodename
            // into parts. Assume a color will have at least 3 digits (rgb).
            possible_nodename = matches[1];
            possible_color    = matches[2];
            matches = possible_color.match(
                /^#([0-9A-F]{3,6})?(\.\d{1,4})?$/i );
            if ( matches !== null ) {
                // We got matches; rewrite the node & interpret the extra data
                flow.target = possible_nodename;
                // Was there a color spec?
                if ( matches[1] ) {
                    flow_color = '#' + matches[1];
                }
                // Was there an opacity argument?
                if ( matches[2] ) {
                    opacity = matches[2];
                    // Make the hover opacity halfway between opacity and 1:
                    opacity_on_hover = ( Number(opacity) + 1 ) / 2;
                }
            }
            // Otherwise we just treat it as part of the nodename, e.g. "Team #1"
        }
        save_node(flow.source);
        save_node(flow.target);

        // Add the encoded flow to the list of approved flows:
        const flow_struct = {
            source: unique_nodes[flow.source].index,
            target: unique_nodes[flow.target].index,
            value:  flow.amount,
            color:  flow_color,
            opacity:          opacity,
            opacity_on_hover: opacity_on_hover
        };
        if (graphIsReversed) {
            const tmp = flow_struct.source;
            flow_struct.source = flow_struct.target;
            flow_struct.target = tmp;
        }
        approved_flows.push(flow_struct);
    });

    // Construct the approved_nodes structure:
    node_order.forEach( function (nodename) {
        let this_node = unique_nodes[nodename], readynode = {},
            inherit_left = 0, inherit_right = 0, node_total = 0;

        // Right & left here correspond to >> and <<. These will have to be
        // swapped if the graph is reversed.
        inherit_left =
            ( this_node.inherit1 === "<<" || this_node.inherit2 === "<<" )
            ? 1
            : 0;
        inherit_right =
            ( this_node.inherit1 === ">>" || this_node.inherit2 === ">>" )
            ? 1
            : 0;
        readynode = {
            name:    nodename,
            index:   this_node.index,
            color:   this_node.color,
            opacity: this_node.opacity,
            inherit_right: graphIsReversed ? inherit_left  : inherit_right,
            inherit_left:  graphIsReversed ? inherit_right : inherit_left
        };

        // approved_nodes = the real node list, formatted for the render routine:
        approved_nodes.push(readynode);
    });

    // Whole positive numbers:
    ([ "canvas_width", "canvas_height", "font_size",
        "top_margin",  "right_margin",  "bottom_margin",
        "left_margin", "font_weight",   "node_spacing",
        "node_width",  "node_border" ]).forEach( function(field_name) {
        const field_val = el(field_name).value;
        if (field_val.length < 10 && field_val.match(/^\d+$/)) {
            approved_config[field_name] = Number(field_val);
        } else {
            reset_field(field_name);
        }
    });

    // Vet the color theme offset fields:
    colorThemes.forEach( (theme, themeKey) => {
        const field_name = `theme_${themeKey}_offset`,
              field_val = el(field_name).value;
        // Verify that the number matches up with the possible offset
        // range for each theme.
        // It has to be either 1 or 2 digits (some ranges have > 9 options):
        if (field_val.match(/^\d{1,2}$/)
            // No '-', so it's at least a positive number. Is it too big?:
            && Number(field_val) <= (theme.colorset.length - 1)) {
            // It's a valid offset, let it through:
            approved_config[field_name] = Number(field_val);
        } else {
            reset_field(field_name);
        }
    });

    (["default_flow_color", "background_color", "font_color",
        "default_node_color" ]).forEach( function(field_name) {
        get_color_input(field_name);
    });

    // Since we know the canvas' intended size now, go ahead & set that up
    // (before we potentially quit):
    chart_el.style.height = approved_config.canvas_height + "px";
    chart_el.style.width  = approved_config.canvas_width  + "px";

    // Are there any good flows at all? If not, offer a little help & exit:
    if ( good_flows.length === 0 ) {
        addMsgAbove(
            'Enter a list of Flows &mdash; one per line. '
            + 'See the <a href="/manual/" target="_blank">Manual</a> for more help.',
            'okmessage', true );

        // Clear the contents of the graph in case there was an old graph left
        // over:
        makeDiagramBlank(approved_config);

        // Also clear out any leftover export output by rendering the
        // currently-blank canvas:
        glob.renderExportableOutputs();

        // No point in proceeding any further. Return to the browser:
        return null;
    }

    // Verify valid plain strings:
    (["unit_prefix", "unit_suffix"]).forEach( function(field_name) {
        const field_val = el(field_name).value;
        if (typeof field_val !== "undefined"
            && field_val !== null
            && field_val.length <= 10) {
            approved_config[field_name] = field_val;
        } else {
            reset_field(field_name);
        }
    });

    // Interpret user's number format settings:
    (["number_format"]).forEach( function(field_name) {
        const field_val = el(field_name).value;
        if (field_val.length === 2 && ( /^[,.\ X][,.]$/.exec(field_val) ) ) {
            // Grab the 1st character if it's a valid 'thousands' value:
            const new_thousands = (/^[,.\ X]/.exec(field_val))[0];
            // No Separator (X) is a special case:
            approved_config.seps.thousands =
               new_thousands === "X" ? "" : new_thousands;
            // Grab the 2nd character if it's a valid 'decimal' value:
            approved_config.seps.decimal = (/^.([,.])/.exec(field_val))[1];
        } else {
            reset_field(field_name);
        }
    });

    // RADIO VALUES:

    // Direction of flow color inheritance:
    // Allowed values = source|target|none
    flow_inherit = radioRef("default_flow_inherit").value;
    if ( flow_inherit.match( /^(?:source|target|outside_in|none)$/ ) ) {
        if (graphIsReversed) {
            flow_inherit
                = flow_inherit === "source" ? "target"
                : flow_inherit === "target" ? "source"
                : flow_inherit;
        }
        approved_config.default_flow_inherit = flow_inherit;
    } // otherwise skip & use the default

    labelpos_in = radioRef("label_pos").value;
    if ( labelpos_in.match( /^(?:all_left|auto|all_right)$/ ) ) {
        approved_config.label_pos = labelpos_in;
    }

    fontface_in = radioRef("font_face").value;
    if ( fontface_in.match( /^(?:serif|sans-serif|monospace)$/ ) ) {
        approved_config.font_face = fontface_in;
    }

    colorset_in = radioRef("default_node_colorset").value;
    if ( colorset_in.match( /^(?:[abcd]|none)$/ ) ) {
        approved_config.default_node_colorset = colorset_in;
        // Given the selected theme, what's the specific offset for that theme?
        approved_config.selected_theme_offset =
            colorset_in === 'none'
            ? 0
            : approved_config[`theme_${colorset_in}_offset`];
    }

    // Checkboxes:
    (["display_full_precision", "include_values_in_node_labels",
        "show_labels", "background_transparent", "justify_origins",
        "justify_ends", "mention_sankeymatic"]).forEach( function(field_name) {
        approved_config[field_name] = el(field_name).checked;
    });

    // Decimal:
    (["default_node_opacity","default_flow_opacity",
        "curvature"]).forEach( function(field_name) {
        const field_val = el(field_name).value;
        if ( field_val.match(/^\d(?:.\d+)?$/) ) {
            approved_config[field_name] = field_val;
        } else {
            reset_field(field_name);
        }
    });

    // All is ready. Do the actual rendering:
    render_sankey( approved_nodes, approved_flows, approved_config );

    // Re-make the PNG+SVG outputs in the background so they are ready to use:
    glob.renderExportableOutputs();

    // POST-RENDER ACTIVITY: various stats and UI updates.

    // Given max_places, we can derive the smallest important difference,
    // defined as smallest-input-decimal/10; this lets us work around various
    // binary/decimal math issues.
    epsilon_difference = Math.pow( 10, -max_places - 1 );

    // After rendering, there are now more keys in the node records, including
    // totalIn/Out and value.
    approved_nodes.forEach( (n, i) => {
        // Skip checking any nodes with 0 as the From or To amount; those are
        // the origins & endpoints for the whole graph and don't qualify:
        if (n.totalIn > 0 && n.totalOut > 0) {
            const difference = n.totalIn - n.totalOut;
            // Is there a difference big enough to matter? (i.e. > epsilon)
            // We'll always calculate this, even if not shown to the user.
            if ( Math.abs(difference) > epsilon_difference ) {
                differences.push({
                    name: n.name,
                    total_in: explainSum(n.totalIn, n.flowsIn),
                    total_out: explainSum(n.totalOut, n.flowsOut),
                    difference: unit_fy(difference),
                });
            }
        } else {
            // Accumulate totals in & out of the graph
            // (On this path, one of these values will be 0 every time.)
            total_inflow  += n.totalIn;
            total_outflow += n.totalOut;
        }

        // Btw, check if this is a new maximum node:
        if (n.value > max_node_val) {
            max_node_index = i;
            max_node_val   = n.value;
        }
    });

    // Update UI options based on the presence of mismatched rows:
    if (differences.length) {
        // Enable the controls for letting the user show the differences:
        list_differences_el.disabled = false;
        differences_el.setAttribute('aria-disabled', false);
    } else {
        // Disable the controls for telling the user about differences:
        list_differences_el.disabled = true;
        differences_el.setAttribute('aria-disabled', true);
    }

    // Were there any differences, and does the user want to know?
    if (differences.length && list_differences_el.checked) {
        // Construct a hyper-informative error message about any differences:
        let differenceRows = [
            "<tr><td></td><th>Total In</th><th>Total Out</th><th>Difference</th></tr>"
        ];
        // Make a nice table of the differences:
        differences.forEach( diffRec => {
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
    status_message =
        `<strong>${approved_flows.length} Flows</strong> between `
        + `<strong>${approved_nodes.length} Nodes</strong>. `;

    // Do the totals match? If not, mention the different totals:
    if ( Math.abs( total_inflow - total_outflow ) < epsilon_difference ) {
        status_message += 'Total Inputs = Total Outputs = '
            + `<strong>${unit_fy(total_inflow)}</strong> &#9989;`;
    } else {
        status_message +=
            `Total Inputs: <strong>${unit_fy(total_inflow)}</strong> `
            + (total_inflow > total_outflow ? '&gt;' : '&lt;')
            + ` Total Outputs: <strong>${unit_fy(total_outflow)}</strong>`;
    }
    setTotalsMsg(status_message);

    updateColorThemeDisplay();

    // Now that the SVG code has been generated, figure out this diagram's
    // Scale & make that available to the user:
    const tallest_node_height
        = parseFloat(
            el( 'r' + max_node_index ).getAttributeNS( null,"height" )
            );
    // Use plenty of precision for the scale output (4 decimal places):
    el('scale_figures').innerHTML =
        `<strong>${unit_fy(max_node_val/tallest_node_height, 4)}</strong> `
        + `per pixel (${unit_fy(max_node_val)}/`
        + fix_separators(d3.format(",.2f")(tallest_node_height),approved_config.seps)
        + `px)`;

    updateResetNodesUI();

    // All done. Give control back to the browser:
    return null;
};

}(window === 'undefined' ? global : window));
