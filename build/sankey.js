d3.sankey = function() {
 "use strict";
  var sankey = {},
      nodeWidth = 9,
      nodeSpacingFactor = 0.5,
      size = [1, 1],
      nodes = [],
      flows = [],
      rightJustifyEndpoints = false,
      leftJustifyOrigins = false,
      nodePadding = 0;

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

  // computeNodeValues: Compute the value (size) of each node by summing the
  // associated flows.
  function computeNodeValues() {
    // Each node will equal the greater of the flows coming in or out:
    nodes.forEach(n => {
      n.value = Math.max( valueSum(n.flowsOut), valueSum(n.flowsIn) );
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
        nextNodes,
        furthestStage = 0;

    // This node needs a stage assigned/updated.
    function updateNode(n) {
        // Set x-position and width:
        n.x = furthestStage;
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
        // If this node is not the target for any others, then it's an origin
        if (!n.flowsIn.length) {
          // Now move it as far right as it can go:
          n.x = d3.min(n.flowsOut, d => d.target.x) - 1;
        }
      });
    }

    function moveSinksRight(lastStage) {
      nodes.forEach(n => {
        // If this node is not the source for any others, then it's a dead-end
        if (!n.flowsOut.length) {
          // Now move it all the way to the right of the diagram:
          n.x = lastStage;
        }
      });
    }

    function scaleNodeStages(kx) {
      nodes.forEach(n => { n.x *= kx; });
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
    if (rightJustifyEndpoints) { moveSinksRight(furthestStage - 1); }

    // Apply a scaling factor to the stages to calculate an exact x-coordinate
    // for each node:
    scaleNodeStages( (size[0] - nodeWidth) / (furthestStage - 1) );
  }

  // placeNodes: Compute the depth (y-position) for each node.
  function placeNodes(iterations) {
    var alpha = 1,
        // stages = one array for each stage, containing that stage's nodes:
        stages = Array.from(d3.group(nodes, d => d.x)).map(d => d[1]);

    function initializeNodeDepth() {
      // How many nodes are in the busiest stage?
      const greatest_node_count = d3.max(stages, s => s.length);

      // What if each node in that stage got 1 pixel?
      // Figure out how many pixels would be left over.
      // If it's < 2, use 2 because otherwise the slider has nothing to do..
      const all_available_padding = Math.max(2, size[1] - greatest_node_count);

      // A nodeSpacingFactor of 1 means 'pad as much as possible without making
      // these nodes less than a pixel tall'.
      //   padding value for nSF of 1 =
      //      all_available_padding / (# of spaces in the busiest stage)
      // Calculate the actual nodePadding value:
      nodePadding = nodeSpacingFactor
        * all_available_padding
        / (greatest_node_count - 1);

      // Finally, calculate the vertical scaling factor for all nodes, given the
      // derived padding value and the diagram height:
      var ky = d3.min(stages,
        s => {
          return (size[1] - (s.length - 1) * nodePadding) / valueSum(s);
        });

      stages.forEach(s => {
        s.forEach( (n, i) => {
          n.y = i; // i = a counter (0 to the # of nodes in this stage)
          // scale every node's raw value to the final height in the graph
          n.dy = n.value * ky;
        });
      });

      // Set flows' raw dy value using the scale of the graph
      flows.forEach( f => { f.dy = f.value * ky; } );
    }

    function resolveCollisions() {
      stages.forEach(s => {
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
          current_y = current_node.y + current_node.dy + nodePadding;
        }

        // If the last/bottom-most node goes outside the bounds, push it back up.
        y_distance = current_y - nodePadding - size[1];
        if (y_distance > 0) {
          current_node.y -= y_distance;
          current_y = current_node.y;

          // From there, push any now-overlapping nodes back up.
          for (i = nodes_in_group - 2; i >= 0; i -= 1) {
            current_node = s[i];
            y_distance = current_node.y + current_node.dy + nodePadding - current_y;
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

      stages.forEach(s => {
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

      stages.slice().reverse().forEach(s => {
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

    //
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
        n.orig_x = n.x;
        n.orig_y = n.y;
    });
  }

  sankey.layout = function(iterations) {
    connectFlowsToNodes();
    computeNodeValues();
    assignNodesToStages();
    placeNodes(iterations);
    return sankey;
  };

  // Given a new set of node positions, calculate where the flows must now be:
  sankey.relayout = function() {
    placeFlowsInsideNodes();
    return sankey;
  };

  return sankey;
};
