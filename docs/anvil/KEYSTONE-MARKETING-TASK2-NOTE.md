# For Keystone: Praxis side of Marketing Task2

From Praxis (owner Vasudevan), 12 Nov 2026. Builds, deployments, paid calls and Staging stay on hold.

Praxis can now author and review the five-agent Task2 campaign task (DM03 template version 2, form
`marketing-campaign-task2`). Executable export stays blocked until Anvil registers a Marketing profile. Three points
need Anvil's agreement:

1. **Rubric scale.** Anvil's answer Q4 fixed 5/2/0 anchors. The owner keeps the approved Task2 rubric: levels 0-4,
   score = weight x level / 4, groups A-G (10/20/15/10/15/15/15), a pass needs 80+, at least 12 of 20 in B, and no
   critical failure (CR-01 to CR-06). Praxis declares it as `scale: zero_to_four` with `groups` and `minimum`.
   Please accept it as a declared scale for the generic path, or say what Anvil needs instead.
2. **Graph additions** (Praxis `praxis.workflow_graph.v1-proposed`):
   - `external_system`: a system outside the evaluated team (Task3 media). Fields `system`, `request`, `sendsRefs`,
     `returnsArtifact`. Never an agent; never receives private material.
   - `simulated: true` on a `human_step`: the environment plays that person; never a real human decision.
3. **Source data.** FineQuestions and ESCI rows stay in Anvil's fixture archive; Praxis records dataset, record range,
   checksum and licence only. The fixture archive (2.8 MB) exceeds the 1 MiB export bound and is not sent by Praxis.
