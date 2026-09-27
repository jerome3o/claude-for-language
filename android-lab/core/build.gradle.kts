import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
}

// Golden vectors come from running the web app's own TypeScript (android-lab/parity).
// They are regenerated before every test run, so a change to shared/scheduler,
// shared/decks/budget or the answer checker that the Kotlin port doesn't match
// fails `./gradlew test`. Needs node + the repo's node_modules (npm ci at the root).
val parityDir = layout.buildDirectory.dir("parity")
val generateParityFixtures by tasks.registering(Exec::class) {
    val repoRoot = rootProject.projectDir.parentFile
    inputs.file(rootProject.file("parity/generate-fixtures.ts"))
    inputs.dir(File(repoRoot, "shared/scheduler"))
    inputs.dir(File(repoRoot, "shared/decks"))
    inputs.file(File(repoRoot, "frontend/src/utils/numberHanzi.ts"))
    outputs.dir(parityDir)
    commandLine("bash", rootProject.file("parity/generate.sh").absolutePath, parityDir.get().asFile.absolutePath)
}

tasks.test {
    dependsOn(generateParityFixtures)
    systemProperty("parity.dir", parityDir.get().asFile.absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
