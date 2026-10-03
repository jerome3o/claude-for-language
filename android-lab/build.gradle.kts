plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.roborazzi) apply false
}

// The build cache (gradle.properties) reuses compiled outputs, never test results: every test
// runs on every build, as before.
subprojects {
    tasks.withType<Test>().configureEach {
        outputs.doNotCacheIf("tests always run") { true }
    }
}
