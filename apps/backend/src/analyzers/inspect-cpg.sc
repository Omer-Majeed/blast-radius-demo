// Diagnostic: dump the shape of a CPG so we can see what joern-parse
// actually included.
//
// Usage:
//   joern --script inspect-cpg.sc --param cpgPath=<path-to-cpg.bin>
//
// Outputs to stdout:
//   - Total File and Method counts.
//   - Files grouped by their top-level directory (so we can see whether
//     joern-parse pulled in `consumer/`, `hash-lib/`, both, or something
//     else entirely).
//   - Every `createHash` call site: file, line, method.
//   - Every `json`/`send` call site (potential HTTP sinks): file, line, method.
//   - reachableByFlows result from createHash sources to those sinks.

import io.shiftleft.semanticcpg.language._
import io.joern.dataflowengineoss.language._
import io.joern.dataflowengineoss.queryengine.EngineContext

@main def main(cpgPath: String) = {
  importCpg(cpgPath)
  implicit val ctx: EngineContext = EngineContext()

  println("=" * 70)
  println("CPG SHAPE")
  println("=" * 70)

  val files = cpg.file.l
  println(s"Total File nodes: ${files.length}")
  println(s"Total Method nodes: ${cpg.method.l.length}")
  println(s"Total Call nodes: ${cpg.call.l.length}")

  println()
  println("Files, grouped by top-level directory (after the CPG's project root):")
  val fileNames = cpg.file.name.l.filterNot(_ == "<unknown>").filterNot(_.isEmpty).distinct.sorted
  val grouped = fileNames.groupBy { name =>
    val parts = name.split("/").filter(_.nonEmpty)
    if (parts.length >= 1) parts.head else "(root)"
  }
  for ((topDir, members) <- grouped.toList.sortBy(_._1)) {
    println(s"  $topDir/  (${members.length} file(s))")
    for (f <- members.take(15)) println(s"    $f")
    if (members.length > 15) println(s"    ... and ${members.length - 15} more")
  }

  println()
  println("=" * 70)
  println("SOURCES — createHash / createHmac calls")
  println("=" * 70)

  val hashCalls = cpg.call
    .name("createHash|createHmac")
    .l
  println(s"Found ${hashCalls.length} createHash/createHmac call(s):")
  for (c <- hashCalls) {
    val file = c.file.name.headOption.getOrElse("<no-file>")
    val line = c.lineNumber.map(_.toInt).getOrElse(-1)
    val method = c.method.fullName
    val code = c.code.take(120)
    println(s"  $file:$line  method=$method")
    println(s"    code: $code")
  }

  println()
  println("=" * 70)
  println("SINKS — json / send / end / write calls with res-like receiver")
  println("=" * 70)

  val httpSinks = cpg.call
    .name("json|send|end|write|writeHead|status")
    .filter(c => {
      // Loose check: code starts with res. / response. / reply.
      val code = c.code
      code.matches("(?s)^\\s*(res|response|reply)\\..*")
    })
    .l
  println(s"Found ${httpSinks.length} likely-HTTP-response sink(s):")
  for (c <- httpSinks) {
    val file = c.file.name.headOption.getOrElse("<no-file>")
    val line = c.lineNumber.map(_.toInt).getOrElse(-1)
    val method = c.method.fullName
    val code = c.code.take(120)
    println(s"  $file:$line  method=$method")
    println(s"    code: $code")
  }

  println()
  println("=" * 70)
  println("FLOW — createHash → HTTP sinks")
  println("=" * 70)

  if (hashCalls.isEmpty || httpSinks.isEmpty) {
    println("Skipped (need both sources and sinks in the CPG).")
  } else {
    val flows = httpSinks.reachableByFlows(hashCalls).l
    println(s"Found ${flows.length} flow path(s):")
    for ((flow, i) <- flows.zipWithIndex) {
      println(s"  --- flow #${i + 1} (${flow.elements.length} hop(s)) ---")
      for (n <- flow.elements) {
        val file = n.file.name.headOption.getOrElse("<no-file>")
        val line = n.lineNumber.map(_.toInt).getOrElse(-1)
        val callName = n match {
          case c: io.shiftleft.codepropertygraph.generated.nodes.Call => c.name
          case _ => n.getClass.getSimpleName
        }
        val code = n.code.take(90).replace("\n", " ")
        println(s"    $file:$line  [$callName]  $code")
      }
    }
  }

  println()
  println("done.")
}
