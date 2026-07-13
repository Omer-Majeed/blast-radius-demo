// Joern flow script: for each finding (file + line), find candidate source
// Call nodes at that location and compute reachable Call nodes via DDG.
// Emits a JSON array of {finding_id, flows: [{nodes: [{file, line, code, method, callName}]}]}.
//
// Usage (via 09-run-joern-flow.sh style wrapping):
//   joern --script flow.sc \
//         --param cpgPath=<path-to-cpg.bin> \
//         --param findingsJson=<path-to-json> \
//         --param outPath=<path-to-out.json>

import io.shiftleft.semanticcpg.language._
import io.joern.dataflowengineoss.language._
import io.joern.dataflowengineoss.queryengine.EngineContext

import scala.io.Source
import java.io.PrintWriter

@main def main(cpgPath: String, findingsJson: String, outPath: String) = {
  importCpg(cpgPath)
  implicit val ctx: EngineContext = EngineContext()

  val findingsRaw = Source.fromFile(findingsJson).mkString
  val findings = ujson.read(findingsRaw).arr

  // Broad sink set: every non-test Call node, excluding node_modules.
  val allCalls = cpg.call
    .filter(c => !c.file.name.headOption.exists(f => f.contains("node_modules") || f.contains(".test.") || f.contains(".spec.")))
    .l

  val results = ujson.Arr()

  for (finding <- findings) {
    val fid = finding("id").str
    val ffile = finding("file").str
    val fline = finding("line").num.toInt

    // Sources: real Call nodes (not IR operators) at the finding's EXACT
    // line. The previous ±2 line window pulled in unrelated calls on
    // neighbouring lines (e.g. `new Date().toISOString()` picked up when
    // the finding was a SHA-1 hash on the previous line).
    val callSources = cpg.call
      .filter(c => !c.name.startsWith("<operator>"))
      .filter(c => c.file.name.headOption.exists(_.endsWith(ffile)))
      .filter(_.lineNumber.exists(_ == fline))
      .l

    // Fallback: if the caller seeded us at a Method's declaration line
    // (e.g. a symbol-callout hop that landed at the callee's def), no
    // Call nodes will be there — use the method's parameters as sources
    // instead, so Joern's DDG propagates from parameter bindings through
    // the body to sinks.
    val sources: List[io.shiftleft.codepropertygraph.generated.nodes.CfgNode] =
      if (callSources.nonEmpty) callSources
      else cpg.method
        .filter(m => m.filename.endsWith(ffile))
        .filter(_.lineNumber.exists(_ == fline))
        .parameter
        .l

    val flows =
      if (sources.isEmpty) List.empty
      else allCalls.reachableByFlows(sources).l

    val flowArr = ujson.Arr()
    for (flow <- flows) {
      // Drop Joern IR artifacts from the emitted path. Two families:
      //
      //   Operator pseudo-calls
      //     `<operator>.assignment`, `<operator>.new`,
      //     `<operator>.fieldAccess`, `<operator>.alloc`, ...
      //     — Joern's internal representation of language constructs
      //     that aren't real function calls.
      //
      //   Synthetic identifiers
      //     `_tmp_N`   — object literals / complex expressions get
      //                  lowered into temp assignments; the temp is
      //                  never in the source.
      //     `__ecma_N` — JS-specific temporaries introduced by the
      //                  jssrc2cpg lowering.
      //     `<lambda>N`— anonymous function placeholders.
      //
      // If we later add an engineer-mode toggle, re-emit these.
      val elements = flow.elements.filterNot {
        case c: io.shiftleft.codepropertygraph.generated.nodes.Call =>
          c.name.startsWith("<operator>")
        case i: io.shiftleft.codepropertygraph.generated.nodes.Identifier =>
          i.name.matches("_tmp_\\d+") ||
          i.name.matches("__ecma_\\d+") ||
          i.name.startsWith("<lambda>")
        case _ => false
      }
      if (elements.nonEmpty) {
        val nodeArr = ujson.Arr()
        for (n <- elements) {
          val file = n.file.name.headOption.getOrElse("")
          val line = n.lineNumber.map(_.toInt).getOrElse(-1)
          // `.method` only exists on CfgNode (and subtypes). Cast defensively.
          val methodName = n match {
            case c: io.shiftleft.codepropertygraph.generated.nodes.CfgNode =>
              c.method.name
            case _ => ""
          }
          val callName = n match {
            case c: io.shiftleft.codepropertygraph.generated.nodes.Call => c.name
            case _ => ""
          }
          nodeArr.value += ujson.Obj(
            "file"     -> file,
            "line"     -> line,
            "code"     -> n.code,
            "method"   -> methodName,
            "callName" -> callName,
          )
        }
        flowArr.value += ujson.Obj("nodes" -> nodeArr)
      }
    }

    results.value += ujson.Obj(
      "finding_id" -> fid,
      "flows"      -> flowArr,
    )
  }

  val pw = new PrintWriter(new java.io.File(outPath))
  try pw.write(ujson.write(results, indent = 2))
  finally pw.close()

  println(s"Wrote ${results.value.size} finding-flow record(s) to $outPath")
}
