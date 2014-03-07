/* sankeymatic.js */
/* Requires:
    D3
    canvg
*/

function isNumeric(n) {
    // borrowed from jquery:
    /* "parseFloat NaNs numeric-cast false positives (null|true|false|"")
       ...but misinterprets leading-number strings, particularly hex literals ("0x...")
       subtraction forces infinities to NaN" */
    return n - parseFloat(n) >= 0;
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function remove_zeroes(number_string) {
    // Strip off zeros from after any decimal.
    // If no digits remain, remove the '.' as well.
    return number_string.replace( /(\.\d*?)0+$/, '$1' )
        .replace( /\.$/, '');
}

function radio_value(radio_input_name) {
    var i = 0, radios = document.getElementsByName(radio_input_name);
    for (i = 0; i < radios.length; i++) {
        if (radios[i].checked) { return radios[i].value; }
    }
}

function update_png() {
    "use strict";
    // Since 'innerHTML' isn't supposed to work for XML (SVG) nodes (though it
    // does seem to in Firefox), we string together the node contents to submit
    // to the canvas converter:
    var svg_content
         = ( new XMLSerializer() ).serializeToString(
            document.getElementById("the_svg") ),
        canvas_context = '', svg_as_png_url = '',
        canvas_el    = document.getElementById("png_preview"),
        png_link_el  = document.getElementById("download_png"),
        chart_el     = document.getElementById("chart"),
        scale_factor = radio_value("scale_x") || 1,
        h = 0, w = 0;

    // Do any scaling necessary.
    // This is a horrible way to get the original size of the chart:
    w = Number( chart_el.style.width.replace(/px/,'') ) * scale_factor;
    h = Number( chart_el.style.height.replace(/px/,'') ) * scale_factor;
    canvas_el.width = w;
    canvas_el.height = h;

    // Draw the svg contents on the canvas:
    canvg( canvas_el, svg_content, {
        ignoreMouse: true,
        ignoreAnimation: true,
        ignoreDimensions: true, // DON'T make the canvas size match the svg's
        scaleWidth: w,
        scaleHeight: h
        } );

    // set background = white by drawing rect on entire canvas
    // credit to Mike Chambers (@mesh) for this approach:
    canvas_context = canvas_el.getContext("2d");
    canvas_context.globalCompositeOperation = "destination-over";
    // Why trust this value? Because we vetted it or replaced it moments ago:
    canvas_context.fillStyle
        = document.getElementById("background_color").value;
    canvas_context.fillRect( 0, 0, w, h);

    // Convert canvas image to a PNG:
    svg_as_png_url = canvas_el.toDataURL('image/png');
    // make it downloadable
    svg_as_png_url = svg_as_png_url.replace('image/png','image/octet-stream');
    png_link_el.setAttribute( "href", svg_as_png_url );

    // update download link & filename with dimensions:
    png_link_el.innerHTML = "Download " + w + " x " + h + " PNG";
    png_link_el.setAttribute( "download", "sankeymatic_" + w + "x" + h + ".png" );
}

function toggle(el_id) {
    var el = document.getElementById(el_id),
        indicator_el = document.getElementById( el_id + "_indicator" ),
        hint_el      = document.getElementById( el_id + "_hint" ),
        hiding_now = ( el.style.display !== "none" );
    el.style.display       = hiding_now ? "none"   : "";
    hint_el.innerHTML      = hiding_now ? "..."    : ":";
    indicator_el.innerHTML = hiding_now ? "&dArr;" : "&uArr;";
}

function process_sankey() {
    "use strict";
    var source_lines = [], good_flows = [], good_node_lines = [],
        bad_lines = [], node_order = [], line_ix = 0, line_in = '',
        unique_nodes = {}, matches = [], amount_in = 0,
        do_cross_checking = 1, cross_check_error_ct = 0,
        approved_nodes = [], approved_flows = [], approved_config = {},
        total_inflow = 0, total_outflow = 0, max_places = 0,
        epsilon_difference = 0, status_message = '', total_difference = 0,
        svg_content = '', canvas_el = '', chart_el = '',
        png_link_el = '', reverse_the_graph = 0,
        max_node_index = 0, max_node_val = 0, flow_inherit = '',
        colorset_in = '', fontface_in = '',
        messages_el = document.getElementById("messages_area"),
        png_link_el = document.getElementById("download_png"),
        canvas_el   = document.getElementById("png_preview"),
        raw_source  = document.getElementById("flows_in").value;

    // Define utility functions:
    // Put a message on the page using the specified class:
    function add_message( msg_class, msg_html, at_beginning ) {
        var new_msg = '<p class="' + msg_class + '">' + msg_html + '</p>';
        if (at_beginning) {
            messages_el.innerHTML = new_msg + messages_el.innerHTML;
        } else {
            messages_el.innerHTML = messages_el.innerHTML + new_msg;
        }
    }

    // Format a value as it will be in the graph. Uses approved_config and
    // max_places (or a separately submitted 'places' param)
    function unit_fy(number_in, places) {
        var number_portion;
        places = places || max_places;
        number_portion = d3.format( ",." + places + "f" )(number_in);
        return approved_config.unit_prefix
            + ( approved_config.display_full_precision
                ? number_portion
                : remove_zeroes(number_portion) )
            + approved_config.unit_suffix;
    }

    function show_delta(diff) {
        // Returns a complete html string of "Δ = difference-with-units"
        // Shows an explicit +/- sign, then the units (looks cleaner)
        // Only emphasize values > the smallest possible diff in the data:
        var big_diff = ( Math.abs(diff) > (11 * epsilon_difference) );
        return "&Delta; = "
            + ( big_diff ? "<strong>" : "" )
            + ( diff >= 0 ? "+" : "-")  // explicit sign
            + unit_fy( Math.abs(diff) ) // produces no sign
            + ( big_diff ? "</strong>" : "" );
    }

    // BEGIN by resetting all messages:
    messages_el.innerHTML = '';
    png_link_el.innerHTML = "...";

    // Go through lots of validation with plenty of bailout points and
    // informative messages for the poor soul trying to do this.

    // Flows validation:

    // parse into structures: approved_nodes, approved_flows, approved_config
    source_lines = raw_source.split("\n");

    // parse all the input lines, storing good ones vs bad ones:
    for ( line_ix = 0; line_ix < source_lines.length; ++line_ix ) {
        // Does this line match the basic format?
        line_in = source_lines[line_ix].trim();
        // Is it a comment? Skip it entirely:
        if ( line_in.match(/^'/) ) {
            continue;
        }
        // Is it a node spec?
        matches = line_in.match(
                /^:(.+) #([0-9A-F]{0,6})?(\.\d{1,4})?\s*(>>|<<)*\s*(>>|<<)*$/i );
        if ( matches !== null ) {
            good_node_lines.push(
                { 'name' : matches[1].trim(),
                  'color' : matches[2],
                  'opacity' : matches[3],
                  'inherit1' : matches[4],
                  'inherit2' : matches[5]
                } );
            continue;
        }
        matches = line_in.match( /^(.+)\[([\d\.\s\+\-]+)\](.+)$/ );
        if ( matches !== null ) {
            // The Amount looked like a number; is it really (after tossing out
            // whitespace)?
            amount_in = matches[2].replace(/\s/g,'');
            if ( !isNumeric(amount_in) ) {
                bad_lines.push (
                    { 'value' : line_in,
                      'message' : 'The Amount is not a valid decimal number.' } );
            } else if (amount_in <= 0) {
                // The Sankey library doesn't currently support negative numbers or 0:
                bad_lines.push (
                    { 'value' : line_in,
                      'message' : 'Amounts must be greater than 0.' } );
            } else {
                // All seems well, save it as good (even if 0):
                good_flows.push(
                    { 'source' : matches[1].trim(),
                      'target' : matches[3].trim(),
                      'amount' : amount_in } );
                // We need the maximum precision of the inputs (# of characters
                // to the RIGHT of the decimal) for some error checking
                // operations (& display) later:
                max_places =
                    Math.max( max_places,
                        ( ( amount_in.split( /\./ ) )[1] || '' ).length );
            }
        } else if ( line_in !== '' ) {
            // There was input, but something made it not match the pattern:
            bad_lines.push(
                { 'value' : line_in,
                  'message' :
                    'The line is not in the format: Source [Amount] Target' }
            );
        }
        // else, the final case: a blank line. We just skip those silently, so
        // someone can separate their input lines with whitespace if desired.
    }
    // We know max_places now, so we can derive the smallest important difference.
    // Defining it as smallest-input-decimal/10; lets us work around various
    // binary/decimal math issues.
    epsilon_difference = Math.pow( 10, -max_places - 1 );

    // TODO: Disable useless precision checkbox if max_places === 0
    // TODO: Look for cycles and post errors about them

    // Mention the bad lines in the message area:
    bad_lines.forEach( function(parse_error) {
        add_message('errormessage',
            '&quot;<b>' + escapeHtml(parse_error.value) + '</b>&quot;: ' +
             parse_error.message, 0);
    });

    // save_node: Add a node to the unique list (if it's not there already):
    function save_node( nodename, nodeparams ) {
        // Have we NOT seen this node before? Then add it:
        if ( !unique_nodes.hasOwnProperty(nodename) ) {
            // establish the hash:
            unique_nodes[nodename] = {
                "from_sum": 0,   "to_sum": 0,
                "from_list": [], "to_list": [],
                "index": node_order.length
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
                    // Note: If there are multiple lines specifying the same
                    // param for a node, the last one will win:
                    unique_nodes[nodename][p] = nodeparams[p];
                }
            } );
        }
    }

    function reset_field(field_name) {
        // We got bad input, so reset the form field to the default value:
        document.getElementById(field_name).value
            = approved_config[field_name];
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
    reverse_the_graph = document.getElementById("reverse_graph").checked;
    good_flows.forEach( function(flow) {
        // Look for extra content about this flow on the target-node end of the
        // string:
        var possible_color, possible_nodename, flow_color = "", tmp = "",
            opacity = "", opacity_on_hover = "", flow_struct = {};
        // Try to parse; there may be extra info that isn't actually the name:
        // Format of the Target node can be:
        // TODO: Target node ["Custom name for flow"] [#color[.opacity]]
        // e.g. Clinton #CCDDEE
        // e.g. Gondor "Legolas" #998877.25
        // Look for an additional string starting with # for color info
        matches = flow.target.match( /^(.+)\s+(\#\S+)$/ );
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
            // Otherwise we just treat it as part of the nodename
        }
        save_node(flow.source);
        save_node(flow.target);

        // Add the encoded flow to the list of approved flows:
        flow_struct = {
            "source": unique_nodes[flow.source].index,
            "target": unique_nodes[flow.target].index,
            "value": flow.amount,
            "color": flow_color,
            "opacity": opacity,
            "opacity_on_hover": opacity_on_hover
        };
        if (reverse_the_graph) {
            tmp = flow_struct.source;
            flow_struct.source = flow_struct.target;
            flow_struct.target = tmp;
        }
        approved_flows.push(flow_struct);

        // Save useful information for the flow cross-check:
        unique_nodes[flow.source].from_sum += Number(flow.amount);
        unique_nodes[flow.source].from_list.push(flow.amount);
        unique_nodes[flow.target].to_sum += Number(flow.amount);
        unique_nodes[flow.target].to_list.push(flow.amount);
    });

    // Construct the approved_nodes structure:
    node_order.forEach( function (nodename) {
        var this_node = unique_nodes[nodename], readynode = {},
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
            "name": nodename,
            "index": this_node.index,
            "color": this_node.color,
            "opacity": this_node.opacity,
            "inherit_right": reverse_the_graph ? inherit_left : inherit_right,
            "inherit_left": reverse_the_graph ? inherit_right : inherit_left
        };

        // Is this a new maximum node?
        node_total = Math.max( this_node.from_sum, this_node.to_sum );
        if (node_total > max_node_val) {
            max_node_index = this_node.index;
            max_node_val   = node_total;
        }
        // approved_nodes = the real node list, formatted for the render routine:
        approved_nodes.push(readynode);
    });

    // Get & fill in the config.
    // Why now? For one thing, we need the Units for the messages we make below.
    // First fill in basic defaults. Values from the form will override if present.
    approved_config = {
        unit_prefix: "",
        unit_suffix: "",
        max_places: max_places,
        display_full_precision: 1,
        include_values_in_node_labels: 0,
        show_labels: 1,
        canvas_width: 600,
        canvas_height: 500,
        font_size: 13,
        font_weight: 400,
        top_margin: 12, right_margin: 12, bottom_margin: 12, left_margin: 12,
        default_flow_opacity: 0.4,
        default_node_opacity: 0.9,
        node_width: 10,
        node_padding: 12,
        node_border: 0,
        reverse_graph: 0,
        default_flow_inherit: "source",
        default_flow_color: "#666666",
        background_color:   "#FFFFFF",
        font_color:         "#000000",
        default_node_color: "#006699",
        default_node_colorset: "A",
        font_face: "sans-serif"
    };

    // Plain strings:
    (["unit_prefix", "unit_suffix"]).forEach( function(field_name) {
        var field_val = document.getElementById(field_name).value;
        if (field_val.length <= 10) {
            approved_config[field_name] = field_val;
        } else {
            reset_field(field_name);
        }
    });

    // Whole positive numbers:
    ([ "canvas_width", "canvas_height", "font_size",
        "top_margin",  "right_margin",  "bottom_margin",
        "left_margin", "font_weight",   "node_padding",
        "node_width",  "node_border" ]).forEach( function(field_name) {
        var field_val = document.getElementById(field_name).value;
        if (field_val.length < 10 && field_val.match(/^\d+$/)) {
            approved_config[field_name] = Number(field_val);
        } else {
            reset_field(field_name);
        }
    });

    // Direction of flow color inheritance:
    // Allowed values = source|target|none
    flow_inherit = radio_value("default_flow_inherit");
    if ( flow_inherit.match( /^(?:source|target|none)$/ ) ) {
        if (reverse_the_graph) {
            flow_inherit
                = flow_inherit === "source" ? "target"
                : flow_inherit === "target" ? "source"
                : "none";
        }
        approved_config.default_flow_inherit = flow_inherit;
    } // otherwise skip & use the default

    // General HTML color inputs handler:
    function get_color_input( field_name, default_color ) {
        var field_el  = document.getElementById(field_name),
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
    (["default_flow_color", "background_color", "font_color",
        "default_node_color" ]).forEach( function(field_name) {
        get_color_input(field_name);
    });

    colorset_in = radio_value("default_node_colorset");
    if ( colorset_in.match( /^(?:[ABC]|none)$/ ) ) {
        approved_config.default_node_colorset = colorset_in;
    }
    fontface_in = radio_value("font_face");
    if ( fontface_in.match( /^(?:serif|sans\-serif|monospace)$/ ) ) {
        approved_config.font_face = fontface_in;
    }

    // Checkboxes:
    (["display_full_precision", "include_values_in_node_labels",
        "show_labels"]).forEach( function(field_name) {
        approved_config[field_name] = document.getElementById(field_name).checked;
    });

    // Decimal:
    (["default_node_opacity","default_flow_opacity"]).forEach( function(field_name) {
        var field_val = document.getElementById(field_name).value;
        if ( field_val.match(/^\d(?:.\d+)?$/) ) {
            approved_config[field_name] = field_val;
        } else {
            reset_field(field_name);
        }
    });

    do_cross_checking = document.getElementById("flow_cross_check").checked;

    // Given the canvas size, adjust the size of the containing element:
    chart_el = document.getElementById('chart');
    chart_el.style.height = approved_config.canvas_height + "px";
    chart_el.style.width = approved_config.canvas_width + "px";

    // Flow cross-check: Test if the total INTO a node is equal to the amount
    // OUT OF it; warn the user if not:
    node_order.forEach( function(nodename) {
        var this_node = unique_nodes[nodename], difference;
        // Skip any nodes with 0 as the From or To amount; those are the
        // starting & ending nodes for the whole graph:
        if ( this_node.from_sum > 0 && this_node.to_sum > 0) {
            difference = this_node.to_sum - this_node.from_sum;
            // Is the difference great enough to matter? (i.e. bigger than 1/10
            // the smallest unit used?)
            if ( do_cross_checking
                && Math.abs(difference) >= epsilon_difference ) {
                // Construct a hyper-informative error message about the
                // imbalance.
                // If we don't round the outputs to match the maximum precision
                // of the inputs, we get uselessly long repeated decimals:
                if ( cross_check_error_ct === 0 ) {
                    add_message( "cautionmessage", "<strong>Imbalances found:</strong>");
                }
                cross_check_error_ct++;
                add_message( "cautionmessage",
                    "&quot;<b>" + escapeHtml(nodename) + "</b>&quot;: " +
                    "Amount IN (" +
                    '<dfn title="' +
                    this_node.to_list.join(' + ') + '">' +
                    unit_fy(this_node.to_sum) +
                    "</dfn>) &ne; OUT (" +
                    '<dfn title="' +
                    this_node.from_list.join(' + ') + '">' +
                    unit_fy(this_node.from_sum) +
                    "</dfn>). " + show_delta(difference), 0 );
            }
        } else {
            // One of these values will be 0 every time, but so what...
            total_inflow += this_node.from_sum;
            total_outflow += this_node.to_sum;
        }
    });

    // Are there any good flows at all? If not, offer help:
    if ( good_flows.length === 0 ) {
        add_message('okmessage',
            'Enter a list of flows (one per line). See the Examples page.', 0);
        // No point in proceeding any further:
        return null;
    }

    status_message = "Showing: <strong>" + approved_flows.length +
        " flows</strong> between <strong>" + approved_nodes.length +
        " nodes</strong>.";
    total_difference = total_inflow - total_outflow;
    if ( Math.abs(total_difference) < epsilon_difference ) {
        status_message +=
            " Diagram Total IN = Total OUT = <strong>"
            + unit_fy(total_inflow) + "</strong>.";
    } else if (do_cross_checking) {
        // Leave out the differing totals from the status message, issue a
        // Caution instead:
        add_message( "cautionmessage",
            "<strong>Diagram Total IN</strong> (" +
            unit_fy(total_inflow) +
            ") &ne; <strong>Total OUT</strong> (" +
            unit_fy(total_outflow) + "). " + show_delta(total_difference),
            0 );
    } else {
        status_message +=
            " Diagram Total <strong>IN</strong> = <strong>"
            + unit_fy(total_inflow) + "</strong>. Total <strong>OUT</strong> = <strong>"
            + unit_fy(total_outflow) + "</strong>.";
    }
    if (do_cross_checking) {
        if ( cross_check_error_ct === 0 ) {
            status_message += " No imbalances found.";
        }
    } else {
        status_message += ' <span class="importanttext">Flow Cross-Check is <strong>OFF</strong>.</span>';
    }
    add_message( "okmessage", status_message, 1 ); // always display main status line first

    // Do the actual rendering:
    render_sankey( approved_nodes, approved_flows, approved_config );

    // Figure out this diagram's scale:
    var tallest_node_height
        = parseFloat( document.getElementById( "r" + max_node_index ).getAttributeNS( null,"height" ) );
    // Use a high precision for the scale output:
    var scale_report = unit_fy(max_node_val) + " / " +
        d3.format(",.2f")(tallest_node_height) + "px = <strong>" +
        unit_fy( max_node_val / tallest_node_height, 6 ) + "/px</strong>";
    document.getElementById("scale_figures").innerHTML = scale_report;

    update_png();

    return null;
}

function render_sankey(nodes_in, flows_in, config_in) {
    "use strict";

    var graph_width, graph_height, colorset,
        units_format, d3_color_scale, svg, sankey, flow, link, node,
        node_width    = config_in.node_width,
        node_padding  = config_in.node_padding,
        node_border   = config_in.node_border,
        total_width   = config_in.canvas_width,
        total_height  = config_in.canvas_height,
        margin_top    = config_in.top_margin,
        margin_bottom = config_in.bottom_margin,
        margin_left   = config_in.left_margin,
        margin_right  = config_in.right_margin;

    config_in.unit_prefix =
        ( typeof config_in.unit_prefix === "undefined"
            || config_in.unit_prefix === null )
            ? "" : config_in.unit_prefix;
    config_in.unit_suffix =
        ( typeof config_in.unit_suffix === "undefined"
            || config_in.unit_suffix === null)
            ? "" : config_in.unit_suffix;

    // Establish a list of 20 compatible colors to choose from:
    colorset = config_in.default_node_colorset;
    d3_color_scale
        = colorset === "A" ? d3.scale.category20()
        : colorset === "B" ? d3.scale.category20b()
        : d3.scale.category20c();

    // Fill in any un-set node colors up front so they can be inherited from:
    nodes_in.forEach( function(node) {
        if (typeof node.color === 'undefined' || node.color === '') {
            if (colorset === "none") {
                node.color = config_in.default_node_color;
            } else {
                // Use the first word of the label as the basis for
                // finding an already-used color or picking a new one (case
                // sensitive).
                // If there are no 'word' characters, substitute a word-ish value
                // (rather than crash):
                var first_word = ( /^\W*(\w+)/.exec(node.name) || ['','not a word'] )[1];
                node.color = d3_color_scale(first_word);
            }
        }
    });

    var the_clean_json = {
        "nodes": nodes_in,
        "links": flows_in
    };

    // Set the dimensions of the space:
    graph_width = total_width - margin_left - margin_right;
    graph_height = total_height - margin_top - margin_bottom;

    // *&*&*&* TODO: Does this function really need to be assigned to a variable?
    units_format = function (d) {
        var number_portion = d3.format( ",." + config_in.max_places + "f" )(d);
        return config_in.unit_prefix
            + ( config_in.display_full_precision
                ? number_portion
                : remove_zeroes(number_portion) )
            + config_in.unit_suffix;
    };

    // clear out any old contents:
    // Simply emptying the SVG tag didn't work well in Safari; we reset the whole tag here:
    document.getElementById('chart').innerHTML =
        '<svg id="the_svg" height="500" width="600" xmlns="http://www.w3.org/2000/svg" version="1.1"></svg>';

    // Select the svg canvas, set the defined dimensions:
    svg = d3.select("#the_svg")
        .attr("width", total_width)
        .attr("height", total_height)
        .attr("style", "background-color: " + config_in.background_color )
        .append("g")
        .attr("transform", "translate(" + margin_left + "," + margin_top + ")");

    // create a sankey object & its properties..
    sankey = d3.sankey()
        .nodeWidth(node_width)
        .nodePadding(node_padding)
        .size([graph_width, graph_height])
        .nodes(the_clean_json.nodes)
        .links(the_clean_json.links)
        .layout(32);

    // flow is a function returning coordinates and specs for each flow area
    flow = sankey.link();

    link = svg.append("g").selectAll(".link")
        .data(the_clean_json.links)
        .enter()
        .append("path")
        .attr("class", "link")
        .attr("d", flow) // embed coordinates
        .style("fill", "none") // ensure no line gets drawn, just stroke
        .style("stroke-width", function (d) { return Math.max(1, d.dy); })
        // custom stroke color; defaulting to gray if not specified:
        .style("stroke", function (d) {
            // Priority order:
            // 1. color defined specifically for the flow
            // 2. single-inherit-from-source (or target)
            // 3. all-inherit-from-source (or target)
            // 4. default flow color
            return d.color ? d.color
                : d.source.inherit_right ? d.source.color
                : d.target.inherit_left  ? d.target.color
                : config_in.default_flow_inherit === "source" ? d.source.color
                : config_in.default_flow_inherit === "target" ? d.target.color
                : config_in.default_flow_color; })
        .style("stroke-opacity", function (d) {
            return d.opacity || config_in.default_flow_opacity;
            })
        // add hover behavior:
        .on('mouseover', function(d){
            d3.select(this).style( "stroke-opacity",
                d.opacity_on_hover
                || ( ( Number(config_in.default_flow_opacity) + 1 ) / 2 ) );
            })
        .on('mouseout', function(d){
            d3.select(this).style( "stroke-opacity",
                d.opacity || config_in.default_flow_opacity );
            })
        // sets the order of display, seems like:
        .sort(function (a, b) { return b.dy - a.dy; });

    if ( config_in.show_labels ) {
        link.append("title") // Make tooltips for FLOWS
            .text(function (d) {
                return d.source.name + " → " + d.target.name + "\n"
                    + units_format(d.value);
            });
    }

    // define drag function for use in node definitions
    function dragmove(d) {
        // Calculate new position:
        d.x = Math.max(0, Math.min(graph_width - d.dx, d3.event.x));
        d.y = Math.max(0, Math.min(graph_height - d.dy, d3.event.y));
        d3.select(this).attr(
            "transform", "translate(" + d.x + "," + d.y + ")"
        );
        // re-render:
        sankey.relayout();
        // rewrite the flow's data:
        link.attr("d", flow);
        // regenerate the static version, incorporating the drag:
        update_png();
    }

    // Set up NODE info, behaviors:
    node = svg.append("g").selectAll(".node")
        .data(the_clean_json.nodes)
        .enter()
        .append("g")
        .attr("class", "node")
        .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; })
        .call(d3.behavior.drag()
            .origin(function (d) { return d; })
            .on("dragstart", function () { this.parentNode.appendChild(this); })
            .on("drag", dragmove)
            );

    // Construct actual rectangles for NODEs:
    node.append("rect")
        .attr("height", function (d) { return d.dy; })
        .attr("width", node_width)
        // Give a unique ID to each rect that we can reference (for scale calc)
        .attr("id", function(d) { return "r" + d.index; })
        // we made sure above there will be a color defined:
        .style("fill", function (d) { return d.color; })
        .attr( "shape-rendering", "crispEdges" )
        .style("fill-opacity",
            function (d) {
                return d.opacity || config_in.default_node_opacity;
            })
        .style( "stroke-width", config_in.node_border || 0 )
        .style( "stroke", function (d) { return d3.rgb(d.color).darker(2); } )
        .append("title")    // Add tooltips for NODES
        .text(
            function (d) {
                return config_in.show_labels
                    ? d.name + "\n" + units_format(d.value)
                    : "";
            });

    // Put in NODE labels
    node.append("text")
        // x,y = offsets relative to the node rectangle
        .attr("x", -6)
        .attr("y", function (d) { return d.dy / 2; })
        .attr("dy", ".35em")
        .attr("text-anchor", "end")
        .attr("transform", null)
        .text(
            function (d) {
                return config_in.show_labels
                    ? d.name
                        + ( config_in.include_values_in_node_labels
                            ? ": " + units_format(d.value)
                            : "" )
                    : "";
            })
        .style( {   // be explicit about the font specs:
            "stroke-width": "0", // positive stroke-width makes letters fuzzy
            "font-family": config_in.font_face,
            "font-size":   config_in.font_size + "px",
            "font-weight": config_in.font_weight,
            "fill":        config_in.font_color
            } )
        // In the left half of the picture, place labels to the right of nodes:
        .filter(function (d) { return d.x < graph_width / 2; })
        .attr("x", 6 + node_width)
        .attr("text-anchor", "start");
}
