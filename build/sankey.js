d3.sankey = function() {
 "use strict";
  var sankey = {},
      nodeWidth = 9,
      nodeSpacingFactor = 0.5,
      size = [1, 1],
      nodes = [],
      flows = [],
      stagesArr = [],
      rightJustifyEndpoints = false,
      leftJustifyOrigins = false,
      spaceBetweenNodes = 0,
      furthestStage = 0;

  // ACCESSORS //
  sankey.nodeWidth = function(x) {
    if (x === undefined) { return nodeWidth; }
    nodeWidth = +x;
    return sankey;
  };

  sankey.nodeSpacingFactor = function(x) {
    if (x === undefined) { return nodeSpacingFactor; }
    nodeSpacingFactor = +x;
    return sankey;
  };

  sankey.nodes = function(x) {
    if (x === undefined) { return nodes; }
    nodes = x;
    return sankey;
  };

  sankey.flows = function(x) {
    if (x === undefined) { return flows; }
    flows = x;
    return sankey;
  };

  sankey.size = function(x) {
    if (x === undefined) { return size; }
    size = x;
    return sankey;
  };

 sankey.rightJustifyEndpoints = function (x) {
    if (x === undefined) { return rightJustifyEndpoints; }
    rightJustifyEndpoints = x;
    return sankey;
  };

  sankey.leftJustifyOrigins = function (x) {
    if (x === undefined) { return leftJustifyOrigins; }
    leftJustifyOrigins = x;
    return sankey;
  };

  // Getters:
  sankey.stages = function() { return stagesArr; };

  // FUNCTIONS //

  // valueSum: Add up all the 'value' keys from a list of objects:
  function valueSum(list) { return d3.sum(list, d => d.value); }

  // verticalCenter: Y-position of the middle of a node.
  function verticalCenter(n) { return n.y + n.dy / 2; }

  // connectFlowsToNodes: Populate flowsOut and flowsIn for each node.
  // When the source and target are not objects, assume they are indices.
  function connectFlowsToNodes() {
    // Initialize the flow buckets:
    nodes.forEach(n => {
      n.flowsOut = [];  // Flows which use this node as source.
      n.flowsIn = [];   // Flows which use this node as target.
    });

    // Connect each flow to its two nodes:
    flows.forEach(f => {
      // When a value is an index, convert it to the node object:
      if (typeof f.source === "number") { f.source = nodes[f.source]; }
      if (typeof f.target === "number") { f.target = nodes[f.target]; }

      // Add this flow to the affected source & target:
      f.source.flowsOut.push(f);
      f.target.flowsIn.push(f);
    });
  }

  // computeNodeValues: Compute the value of each node by summing the
  // associated flows:
  function computeNodeValues() {
    nodes.forEach(n => {
      // Remember the totals in & out:
      n.totalIn = valueSum(n.flowsIn);
      n.totalOut = valueSum(n.flowsOut);
      // Each node's value will be the greater of the two:
      n.value = Math.max(n.totalIn, n.totalOut);
    });
  }

  // placeFlowsInsideNodes: Compute the y-offset of the source endpoint (sy) and
  // target endpoints (ty) of flows, relative to the source/target node's y-position.
  function placeFlowsInsideNodes() {
    function ascendingSourceDepth(a, b) { return a.source.y - b.source.y; }
    function ascendingTargetDepth(a, b) { return a.target.y - b.target.y; }

    nodes.forEach(n => {
      n.flowsOut.sort(ascendingTargetDepth);
      n.flowsIn.sort(ascendingSourceDepth);
    });

    // Now that the flows are in order according to where we want them to touch
    // each node, calculate/store their specific offsets:
    nodes.forEach(n => {
      // sy (source y) & ty (target y) are the vertical offsets at each end of
      // a flow, determining where *inside* each node each flow will touch:
      var sy = 0, ty = 0;
      n.flowsOut.forEach(f => {
        f.sy = sy;
        sy += f.dy;
      });
      n.flowsIn.forEach(f => {
        f.ty = ty;
        ty += f.dy;
      });
    });
  }

  // assignNodesToStages: Iteratively assign the stage (x-group) for each node.
  // Nodes are assigned the maximum stage of their incoming neighbors + 1.
  // Nodes with no incoming flows are assigned stage 0, while
  // Nodes with no outgoing flows are assigned the maximum stage.
  function assignNodesToStages() {
    var remainingNodes = nodes,
        nextNodes = [];

    // This node needs a stage assigned/updated.
    function updateNode(n) {
        // Set x-position and width:
        n.stage = furthestStage;
        n.dx = nodeWidth;
        // Make sure its targets will be seen again:
        n.flowsOut.forEach(f => {
          // Only add it to the nextNodes list if it is not already present:
          if (nextNodes.indexOf(f.target) === -1) {
            nextNodes.push(f.target);
          }
        });
    }

    function moveOriginsRight() {
      nodes.forEach(n => {
        // If this node is not the target for any others, then it's an origin.
        // If it has 1+ targets (the common case), then move it as far right
        // as it can go without bumping into its targets:
        if (!n.flowsIn.length && n.flowsOut.length) {
          n.stage = d3.min(n.flowsOut, d => d.target.stage) - 1;
        }
      });
    }

    function moveSinksRight() {
      nodes.forEach(n => {
        // If this node is not the source for any others, then it's a dead-end
        if (!n.flowsOut.length) {
          // Now move it all the way to the right of the diagram:
          n.stage = furthestStage - 1;
        }
      });
    }

    // Work from left to right.
    // Keep updating the stage (x-position) of nodes that are targets of
    // recently-updated nodes.
    while (remainingNodes.length && furthestStage < nodes.length) {
      nextNodes = [];
      remainingNodes.forEach(n => updateNode(n));
      remainingNodes = nextNodes;
      furthestStage += 1;
    }

    // Force origins to appear immediately before their first target node?
    // (In this case, we have to do extra work to UN-justify these nodes.)
    if (!leftJustifyOrigins) { moveOriginsRight(); }

    // Force endpoint nodes all the way to the right?
    // Note: furthestStage at this point is 1 beyond the last actual stage:
    if (rightJustifyEndpoints) { moveSinksRight(); }
  }

  // Set up stagesArr: one array element for each stage, containing that
  // stage's nodes, in stage order.
  // This can also be called when nodes' info may have been updated elsewhere &
  // we need a fresh map generated.
  function updateStagesArray() {
    stagesArr = Array.from(d3.group(nodes, d => d.stage))
      .sort((a,b) => { return a[0] - b[0]; })
      .map(d => d[1]);
  }

  // placeNodes: Compute the depth (y-position) for each node.
  function placeNodes(iterations) {
    var alpha = 1;

    function initializeNodeDepth() {
      // How many nodes are in the 'busiest' stage?
      // Note: If every stage has only 1 node, this causes a divide-by-0
      // error..so make sure this is always at least 2:
      const greatestNodeCount = Math.max(2, d3.max(stagesArr, s => s.length));

      // What if each node in that stage got 1 pixel?
      // Figure out how many pixels would be left over.
      // If it's < 2, use 2 because otherwise the slider has nothing to do..
      const allAvailablePadding = Math.max(2, size[1] - greatestNodeCount);

      // A nodeSpacingFactor of 1 means 'pad as much as possible without making
      // these nodes less than a pixel tall'.
      //   padding value for nSF of 1 =
      //      allAvailablePadding / (# of spaces in the busiest stage)
      // Calculate the actual spaceBetweenNodes value:
      spaceBetweenNodes = nodeSpacingFactor * allAvailablePadding
        / (greatestNodeCount - 1);

      // Finally, calculate the vertical scaling factor for all nodes, given the
      // derived spaceBetweenNodes value and the diagram's height:
      var ky = d3.min(stagesArr,
        s => {
          return (size[1] - (s.length - 1) * spaceBetweenNodes) / valueSum(s);
        });

      // Start with each node at the TOP of the graph, each starting 1 pixel
      // lower than the previous. (This will be changed someday soon.):
      stagesArr.forEach(s => {
        s.forEach( (n, i) => {
          n.y = i; // i = a counter (0 to the # of nodes in this stage)
          // Compute every node's final height in the graph (dy).
          // Also: make sure each node is at least 1 pixel, even if its true
          // value is 0:
          n.dy = Math.max(1, n.value * ky);
        });
      });

      // Compute flows' dy value using the scale of the graph:
      flows.forEach( f => { f.dy = f.value * ky; } );
    }

    function resolveCollisions() {
      stagesArr.forEach(s => {
        var current_node,
            y_distance,
            current_y = 0,
            nodes_in_group = s.length,
            i;

        // sort functions for determining what order items should be processed in:
        function ascendingDepth(a, b) { return a.y - b.y; }
        // function orderInSource(a, b) { return a.sourceline - b.sourceline; }

        // Push any overlapping nodes down.
        s.sort(ascendingDepth);
        for (i = 0; i < nodes_in_group; i += 1) {
          current_node = s[i];
          y_distance = current_y - current_node.y;
          if (y_distance > 0) { current_node.y += y_distance; }
          current_y = current_node.y + current_node.dy + spaceBetweenNodes;
        }

        // If the last/bottom-most node goes outside the bounds, push it back up.
        y_distance = current_y - spaceBetweenNodes - size[1];
        if (y_distance > 0) {
          current_node.y -= y_distance;
          current_y = current_node.y;

          // From there, push any now-overlapping nodes back up.
          for (i = nodes_in_group - 2; i >= 0; i -= 1) {
            current_node = s[i];
            y_distance = current_node.y + current_node.dy + spaceBetweenNodes
              - current_y;
            if (y_distance > 0) { current_node.y -= y_distance; }
            current_y = current_node.y;
          }
        }
      });
    }

    function relaxLeftToRight(alpha) {
      function weightedSource(f) {
        return (f.source.y + f.sy + f.dy / 2) * f.value;
      }

      stagesArr.forEach(s => {
        s.forEach(n => {
          if (n.flowsIn.length) {
            // Value-weighted average of the y-position of source node centers
            // linked to this node:
            var y_position = d3.sum(n.flowsIn, weightedSource)
                / valueSum(n.flowsIn);
            n.y += (y_position - verticalCenter(n)) * alpha;
          }
        });
      });
    }

    function relaxRightToLeft(alpha) {
      function weightedTarget(f) {
        return (f.target.y + f.ty + f.dy / 2) * f.value;
      }

      stagesArr.slice().reverse().forEach(s => {
        s.forEach(n => {
          if (n.flowsOut.length) {
            // Value-weighted average of the y-positions of target node centers
            // linked to this node:
            var y_position = d3.sum(n.flowsOut, weightedTarget)
                / valueSum(n.flowsOut);
            n.y += (y_position - verticalCenter(n)) * alpha;
          }
        });
      });
    }

    // Enough preamble. Lay out the nodes:

    // Apply a scaling factor to all stages to calculate the exact x value
    // for each node:
    const widthPerStage = (size[0] - nodeWidth) / (furthestStage - 1);
    nodes.forEach(n => { n.x = widthPerStage * n.stage; });

    initializeNodeDepth();
    resolveCollisions();
    placeFlowsInsideNodes();

    while (iterations > 0) {
      iterations -= 1;

      // Make each round of moves progressively weaker:
      alpha *= 0.99;
      relaxRightToLeft(alpha);
      resolveCollisions();
      placeFlowsInsideNodes();

      relaxLeftToRight(alpha);
      resolveCollisions();
      placeFlowsInsideNodes();
    }

    // After the last layout step, store the original node coordinates
    // (to support drag moves):
    nodes.forEach(n => {
        n.origPos = { x: n.x, y: n.y };
        n.lastPos = { x: n.x, y: n.y };
        n.move = [0, 0];
    });
  }

  // setup() = define the *skeleton* of the diagram -- which nodes link to
  // which, and in which stages -- but no specific positions yet:
  sankey.setup = function() {
    connectFlowsToNodes();
    computeNodeValues();
    assignNodesToStages();
    updateStagesArray();
    return sankey;
  };

  // layout() = Given a complete skeleton, use the given total width/height and
  // set the exact positions of all nodes and flows:
  sankey.layout = function(iterations) {
    // In case anything's changed since setup, re-generate our map:
    updateStagesArray();
    placeNodes(iterations);
    return sankey;
  };

  // relayout() = Given a complete diagram with some new node positions,
  // calculate where the flows must now start/end:
  sankey.relayout = function() {
    placeFlowsInsideNodes();
    return sankey;
  };

  return sankey;
};
