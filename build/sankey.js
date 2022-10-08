d3.sankey = () => {
  'use strict';

  const sankey = {};
  // Set by inputs:
  let nodeWidth = 9,
      nodeSpacingFactor = 0.5,
      size = { w: 1, h: 1 },
      nodes = [],
      flows = [],
      rightJustifyEndpoints = false,
      leftJustifyOrigins = false,
      autoLayout = true,
      // Calculated:
      stagesArr = [],
      spaceBetweenNodes = 0,
      furthestStage = 0;

  // ACCESSORS //
  /* eslint-disable func-names */
  sankey.nodeWidth = function (x) {
    if (arguments.length) { nodeWidth = +x; return sankey; }
    return nodeWidth;
  };

  sankey.nodeSpacingFactor = function (x) {
    if (arguments.length) { nodeSpacingFactor = +x; return sankey; }
    return nodeSpacingFactor;
  };

  sankey.nodes = function (x) {
    if (arguments.length) { nodes = x; return sankey; }
    return nodes;
  };

  sankey.flows = function (x) {
    if (arguments.length) { flows = x; return sankey; }
    return flows;
  };

  sankey.size = function (x) {
    if (arguments.length) { size = x; return sankey; }
    return size;
  };

 sankey.rightJustifyEndpoints = function (x) {
  if (arguments.length) { rightJustifyEndpoints = x; return sankey; }
  return rightJustifyEndpoints;
  };

  sankey.leftJustifyOrigins = function (x) {
    if (arguments.length) { leftJustifyOrigins = x; return sankey; }
    return leftJustifyOrigins;
  };

  sankey.autoLayout = function (x) {
    if (arguments.length) { autoLayout = x; return sankey; }
    return autoLayout;
  };

  // Getters:
  sankey.stages = () => stagesArr;

  // FUNCTIONS //

  // valueSum: Add up all the 'value' keys from a list of objects:
  function valueSum(list) { return d3.sum(list, (d) => d.value); }

  // yCenter & yBottom: Y-position of the middle and end of a node.
  function yCenter(n) { return n.y + n.dy / 2; }
  function yBottom(n) { return n.y + n.dy; }

  // sourceCenter/targetCenter: return the center of one end of a flow:
  function sourceCenter(f) { return f.source.y + f.sy + (f.dy / 2); }
  function targetCenter(f) { return f.target.y + f.ty + (f.dy / 2); }

  // connectFlowsToNodes: Populate flowsOut and flowsIn for each node.
  // When the source and target are not objects, assume they are indices.
  function connectFlowsToNodes() {
    // Initialize the flow buckets:
    nodes.forEach((n) => {
      n.flowsOut = [];  // Flows which use this node as their source.
      n.flowsIn = [];   // Flows which use this node as their target.
    });

    // Connect each flow to its two nodes:
    flows.forEach((f) => {
      // When a value is an index, convert it to the node object:
      if (typeof f.source === 'number') { f.source = nodes[f.source]; }
      if (typeof f.target === 'number') { f.target = nodes[f.target]; }

      // Add this flow to the affected source & target:
      f.source.flowsOut.push(f);
      f.target.flowsIn.push(f);
    });
  }

  // computeNodeValues: Compute the value of each node by summing the
  // associated flows:
  function computeNodeValues() {
    nodes.forEach((n) => {
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
    const [ASC, DESC] = [1, -1];

    // sortFlows(node, placingTargets):
    // Given a node & a side, order those flows as ideally as we can.
    // The existing order is discarded; each time, an order is derived anew.
    // - placingTargets is a boolean; for every call you are either
    //   placing Targets (value = true) or placing Sources (value = false).
    function sortFlows(n, placingTargets) {
      const flowsToSort = placingTargets ? n.flowsIn : n.flowsOut,
        // Make a Set of flow IDs we can delete from as we go:
        flowsRemaining = new Set(flowsToSort.map((f) => f.index)),
        // upper/lower bounds = the extreme ends of the available space.
        // These get carved down from both ends as we go.
        // Reminder: In SVG-land, the y-axis coordinates are reversed.
        // "upper" & "lower" are meant visually here, not numerically.
        bounds = { upper: n.y, lower: n.y + d3.sum(flowsToSort, (f) => f.dy) };

      // placeFlow(f, y): write the new value & drop the flow from the queue.
      function placeFlow(f, newTopY) {
        // sy (source y) & ty (target y) are the vertical *offsets* at each
        // end of a flow, determining where /inside/ each node this flow's
        // top edge will meet, relative to the node's top edge.
        if (placingTargets) {
          f.ty = newTopY - f.target.y;
        } else {
          f.sy = newTopY - f.source.y;
        }
        flowsRemaining.delete(f.index);
      }

      function placeFlowAtTop(fIndex) {
        const f = flows[fIndex]; // We want the real flow, not a copy
        placeFlow(f, bounds.upper);
        // Move the upper bound DOWN by the flow width (after using it):
        bounds.upper += f.dy;
      }

      function placeFlowAtBottom(fIndex) {
        const f = flows[fIndex];
        // Move the lower bound UP by this flow width FIRST, to get both the
        // flow's new top & the range's new bottom:
        bounds.lower -= f.dy;
        placeFlow(f, bounds.lower);
      }

      // sourceSlope calculates FROM the flow source's center TO point y
      // targetSlope calculates FROM point y TO the flow target's center
      // BTW: "fc" = "flow copy": a local copy of a flow + additional keys
      function sourceSlope(fc, y) { return (y - fc.sCenter) / fc.dx; }
      function targetSlope(y, fc) { return (fc.tCenter - y) / fc.dx; }

      // bySourceSlopeUsing(y, dir): Sort flow queue items by:
      //   the source flow's slope TO y (ascending or descending),
      //   then by x-distance (always ascending):
      function bySourceSlopeUsing(y, dir) {
        return (a, b) => dir * (sourceSlope(a, y) - sourceSlope(b, y))
          || (a.dx - b.dx);
      }

      // byTargetSlopeUsing(y, dir): Same as above, but using
      //   the target flow's slope FROM y (ascending or descending), etc.
      function byTargetSlopeUsing(y, dir) {
        return (a, b) => dir * (targetSlope(y, a) - targetSlope(y, b))
          || (a.dx - b.dx);
      }

      // expectedFlowOffset: Given a list of flows, produce a guess
      // as to how wide a representative flow from the set will be.
      function expectedFlowOffset(fList) {
        // We take the midpoint between their mean & their minimum as
        // the 'expected' width, then divide that by 2 again to produce
        // the offset for the center of that predicted width.
        return (d3.mean(fList, (f) => f.dy) + d3.min(fList, (f) => f.dy)) / 4;
      }

      // After all that setup...
      // Place flows from the outside in!
      // If there are 2+ flows to be placed, we figure out which is best
      //    to attach to the top and which to the bottom.
      // After doing so, we re-calculate the remaining landscape.
      // Repeat until we get down to < 2 flows.
      while (flowsRemaining.size > 1) {
        // Make a queue with local copies of the flows we're operating on:
        const flowCopies
          = flowsToSort
              .filter((f) => flowsRemaining.has(f.index))
              .map((f) => ({ ...f })),
          // Estimate a good upper point to calculate slopes to (we won't
          // use this slope for final placement, but we DO use it for
          // dividing up the flowQueue into upper & lower halves.):
          upperBoundAdjusted = bounds.upper + expectedFlowOffset(flowCopies);
        if (placingTargets) {
          flowCopies.forEach((fc) => { fc.sCenter = sourceCenter(fc); });
          flowCopies.sort(bySourceSlopeUsing(upperBoundAdjusted, DESC));
        } else {
          flowCopies.forEach((fc) => { fc.tCenter = targetCenter(fc); });
          flowCopies.sort(byTargetSlopeUsing(upperBoundAdjusted, ASC));
        }

        // With the flows sorted, now we split the queue in half:
        const fqMidpoint = Math.floor(flowCopies.length / 2),
          upperFlows = flowCopies.slice(0, fqMidpoint),
          lowerFlows = flowCopies.slice(fqMidpoint).reverse(),
          // Then figure out our actual target points at the top and bottom,
          // base on the specific flow sizes in each section:
          upperAttachPoint = bounds.upper + expectedFlowOffset(upperFlows),
          lowerAttachPoint = bounds.lower - expectedFlowOffset(lowerFlows);

        // Now, find the least fortunate flow touching each target point:
        if (placingTargets) {
          upperFlows.sort(bySourceSlopeUsing(upperAttachPoint, DESC));
          lowerFlows.sort(bySourceSlopeUsing(lowerAttachPoint, ASC));
        } else {
          upperFlows.sort(byTargetSlopeUsing(upperAttachPoint, ASC));
          lowerFlows.sort(byTargetSlopeUsing(lowerAttachPoint, DESC));
        }
        // Place the 2 flows we've found (and subtract their sizes from the
        // available range):
        placeFlowAtTop(upperFlows[0].index);
        placeFlowAtBottom(lowerFlows[0].index);
        // Now the loop continues, to derive new least-fortunate flows based on
        // the new smaller range.
      }

      // Outside the loop, we have 0-1 flows; place that last flow if present:
      flowsRemaining.forEach((i) => placeFlowAtTop(i));
    }

    // We have the utility functions defined now; time to actually use them.

    // First, update the dx (x-distance) values for all flows.
    // (They may have changed since their initial placement due to drags.)
    // Two notes:
    // 1) we use the *absolute* value of the x-distance, so that even when
    //    a node is dragged to the other side of its source/target, the
    //    slope ordering will remain stable.
    // 2) we have to avoid a dx of 0, so we substitute almost-0 if needed.
    flows.forEach((f) => {
      f.dx = Math.abs(f.target.x - f.source.x) || Number.MIN_VALUE;
    });

    // Gather all the distinct batches of flows we'll need to process (each
    // node may have 0, 1, or 2):
    const flowBatches = [
      ...nodes.filter((n) => n.flowsIn.length)
        .map((n) => (
          { i: n.index, len: n.flowsIn.length, placingTargets: true }
          )),
      ...nodes.filter((n) => n.flowsOut.length)
        .map((n) => (
          { i: n.index, len: n.flowsOut.length, placingTargets: false }
          )),
    ];

    // Sort the flow batches so that we start with those having the FEWEST
    // flows and work upward.
    // Reason: a 1-flow placement is certain; a 2-flow set is simple; etc.
    // By settling easier cases first, the harder cases end up with fewer
    // wild possibilities for how they may be arranged.
    flowBatches.sort((a, b) => a.len - b.len)
      .forEach((fBatch) => {
        // Finally: Go through every batch & sort their flows anew:
        sortFlows(nodes[fBatch.i], fBatch.placingTargets);
      });
  }

  // assignNodesToStages: Iteratively assign the stage (x-group) for each node.
  // Nodes are assigned the maximum stage of their incoming neighbors + 1.
  // Nodes with no incoming flows are assigned stage 0, while
  // Nodes with no outgoing flows are assigned the maximum stage.
  function assignNodesToStages() {
    let remainingNodes = nodes,
        nextNodes = [];

    // This node needs a stage assigned/updated.
    function updateNode(n) {
        n.stage = furthestStage;
        // Make sure its targets will be seen again:
        // (Only add it to the nextNodes list if it is not already present)
        n.flowsOut.filter((f) => !nextNodes.includes(f.target))
          .forEach((f) => { nextNodes.push(f.target); });
    }

    function moveOriginsRight() {
      // If this node is not the target of any others, then it's an origin.
      // If it has at least 1 target (the common case), then move it as far
      // right as it can go without bumping into any of its targets:
      nodes.filter((n) => !n.flowsIn.length && n.flowsOut.length)
        .forEach((n) => {
          n.stage = d3.min(n.flowsOut, (d) => d.target.stage) - 1;
        });
    }

    function moveSinksRight() {
      // If any node is not the source for any others, then it's a dead-end;
      // move it all the way to the right of the diagram:
      nodes.filter((n) => !n.flowsOut.length)
        .forEach((n) => { n.stage = furthestStage - 1; });
    }

    // Work from left to right.
    // Keep updating the stage (x-position) of nodes that are targets of
    // recently-updated nodes.
    while (remainingNodes.length && furthestStage < nodes.length) {
      nextNodes = [];
      remainingNodes.forEach((n) => updateNode(n));
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
    stagesArr = Array.from(d3.group(nodes, (d) => d.stage))
      .sort((a, b) => a[0] - b[0])
      .map((d) => d[1]);
  }

  // placeNodes: Compute the depth (y-position) for each node.
  function placeNodes(iterations) {
    function initializeNodeDepth() {
      // How many nodes are in the 'busiest' stage?
      // Note: If every stage has only 1 node, this causes a divide-by-0
      // error..so make sure this is always at least 2:
      const greatestNodeCount
        = Math.max(2, d3.max(stagesArr, (s) => s.length)),
        // What if each node in that stage got 1 pixel?
        // Figure out how many pixels would be left over.
        // (If it's < 2, use 2; otherwise the slider has nothing to do.)
        allAvailablePadding = Math.max(2, size.h - greatestNodeCount);

      // A nodeSpacingFactor of 1 means 'pad as much as possible without making
      // these nodes less than a pixel tall'.
      //   padding value for nSF of 1 =
      //      allAvailablePadding / (# of spaces in the busiest stage)
      // Calculate the actual spaceBetweenNodes value:
      spaceBetweenNodes
        = (nodeSpacingFactor * allAvailablePadding) / (greatestNodeCount - 1);

      // Finally, calculate the vertical scaling factor for all nodes, given the
      // derived spaceBetweenNodes value and the diagram's height:
      const ky = d3.min(
        stagesArr,
        (s) => (size.h - (s.length - 1) * spaceBetweenNodes) / valueSum(s)
      );

      // Start with each node at the TOP of the graph, each starting 1 pixel
      // lower than the previous. (This will be changed someday soon.):
      stagesArr.forEach((s) => {
        s.forEach((n, i) => {
          n.y = i; // i = a counter (0 to the # of nodes in this stage)
          // Compute every node's final height in the graph (dy).
          // Also: make sure each node is at least 1 pixel, even if its true
          // value is 0:
          n.dy = Math.max(1, n.value * ky);
          n.dx = nodeWidth;
        });
      });

      // Compute flows' dy value using the scale of the graph:
      flows.forEach((f) => { f.dy = f.value * ky; });
    }

    function resolveCollisions() {
      stagesArr.forEach((s) => {
        let current_node,
            y_distance,
            current_y = 0,
            i;
        const nodes_in_group = s.length;

        // sort functions for determining what order items should be processed in:
        function ascendingDepth(a, b) { return a.y - b.y; }
        function orderInSource(a, b) { return a.sourceRow - b.sourceRow; }
        s.sort(autoLayout ? ascendingDepth : orderInSource);

        // Push any overlapping nodes down.
        for (i = 0; i < nodes_in_group; i += 1) {
          current_node = s[i];
          y_distance = current_y - current_node.y;
          if (y_distance > 0) { current_node.y += y_distance; }
          current_y = yBottom(current_node) + spaceBetweenNodes;
        }

        // If the last/bottom-most node goes outside the bounds, push it back up.
        y_distance = current_y - spaceBetweenNodes - size.h;
        if (y_distance > 0) {
          current_node.y -= y_distance;
          current_y = current_node.y;

          // From there, push any now-overlapping nodes back up.
          for (i = nodes_in_group - 2; i >= 0; i -= 1) {
            current_node = s[i];
            y_distance = yBottom(current_node) + spaceBetweenNodes
              - current_y;
            if (y_distance > 0) { current_node.y -= y_distance; }
            current_y = current_node.y;
          }
        }
      });
    }

    function relaxLeftToRight(factor) {
      function weightedSource(f) { return sourceCenter(f) * f.value; }

      stagesArr.forEach((s) => {
        s.filter((n) => n.flowsIn.length)
          .forEach((n) => {
            // Value-weighted average of the y-position of source node centers
            // linked to this node:
            const y_position
              = d3.sum(n.flowsIn, weightedSource) / valueSum(n.flowsIn);
            n.y += (y_position - yCenter(n)) * factor;
        });
      });
    }

    function relaxRightToLeft(factor) {
      function weightedTarget(f) { return targetCenter(f) * f.value; }

      stagesArr.slice().reverse().forEach((s) => {
        s.filter((n) => n.flowsOut.length)
          .forEach((n) => {
            // Value-weighted average of the y-positions of target node centers
            // linked to this node:
            const y_position
              = d3.sum(n.flowsOut, weightedTarget) / valueSum(n.flowsOut);
            n.y += (y_position - yCenter(n)) * factor;
        });
      });
    }

    // Enough preamble. Lay out the nodes:

    // Apply a scaling factor to all stages to calculate the exact x value
    // for each node:
    const widthPerStage = (size.w - nodeWidth) / (furthestStage - 1);
    nodes.forEach((n) => { n.x = widthPerStage * n.stage; });

    initializeNodeDepth();
    resolveCollisions();
    placeFlowsInsideNodes();

    let counter = 0,
      alpha = 1;
    while (counter < iterations) {
      counter += 1;

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
    // (for reference when the user is dragging nodes):
    nodes.forEach((n) => {
        n.origPos = { x: n.x, y: n.y };
        n.lastPos = { x: n.x, y: n.y };
        n.move = [0, 0];
    });
  }

  // setup() = define the *skeleton* of the diagram -- which nodes link to
  // which, and in which stages -- but no specific positions yet:
  sankey.setup = () => {
    connectFlowsToNodes();
    computeNodeValues();
    assignNodesToStages();
    updateStagesArray();
    return sankey;
  };

  // layout() = Given a complete skeleton, use the given total width/height and
  // set the exact positions of all nodes and flows:
  sankey.layout = (iterations) => {
    // In case anything's changed since setup, re-generate our map:
    updateStagesArray();
    placeNodes(iterations);
    return sankey;
  };

  // relayout() = Given a complete diagram with some new node positions,
  // calculate where the flows must now start/end:
  sankey.relayout = () => {
    placeFlowsInsideNodes();
    return sankey;
  };

  return sankey;
};
// Make the linter happy about imported objects:
/* global d3 */
