import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.roborazzi)
}

// CI sets these so every Lab release installs over the previous one (Obtainium).
val appVersionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
val appVersionName = System.getenv("APP_VERSION_NAME") ?: "0.1-dev"
val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_FILE")

// Firebase Cloud Messaging (chat notifications, android-lab/PUSH.md). No google-services plugin
// (it fails the build without the file): when app/google-services.json exists (CI decodes it from
// the GOOGLE_SERVICES_JSON secret) its values become BuildConfig.FCM_*; otherwise they are empty
// and the app runs without FCM (live socket + 15-minute inbox check only).
val fcmConfig: Map<String, String> = run {
    val file = file("google-services.json")
    val empty = mapOf("FCM_PROJECT_ID" to "", "FCM_APP_ID" to "", "FCM_API_KEY" to "", "FCM_SENDER_ID" to "")
    if (!file.exists()) return@run empty
    @Suppress("UNCHECKED_CAST")
    val root = groovy.json.JsonSlurper().parse(file) as Map<String, Any?>
    val project = root["project_info"] as? Map<String, Any?> ?: emptyMap()
    val clients = (root["client"] as? List<Map<String, Any?>>).orEmpty()
    val client = clients.firstOrNull { c ->
        val info = c["client_info"] as? Map<String, Any?>
        val android = info?.get("android_client_info") as? Map<String, Any?>
        android?.get("package_name") == "dev.jeromeswannack.chineselearning.lab"
    } ?: return@run empty.also { logger.warn("google-services.json has no client for dev.jeromeswannack.chineselearning.lab — FCM off") }
    val info = client["client_info"] as Map<String, Any?>
    val key = (client["api_key"] as? List<Map<String, Any?>>)?.firstOrNull()?.get("current_key") as? String
    mapOf(
        "FCM_PROJECT_ID" to (project["project_id"] as? String).orEmpty(),
        "FCM_APP_ID" to (info["mobilesdk_app_id"] as? String).orEmpty(),
        "FCM_API_KEY" to key.orEmpty(),
        "FCM_SENDER_ID" to (project["project_number"]?.toString()).orEmpty(),
    )
}

android {
    namespace = "dev.jeromeswannack.chineselearning.lab"
    compileSdk = 35

    defaultConfig {
        // Separate id from the hybrid app (dev.jeromeswannack.chineselearning): both install side by side.
        applicationId = "dev.jeromeswannack.chineselearning.lab"
        minSdk = 26
        // Google Play: new apps and updates must target API 36 since 31 Aug 2026 (PLAY.md).
        // Robolectric tests pin sdk = [34] in their @Config, so they are unaffected.
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        // WebRTC ships native code for 4 ABIs (~20 MB); phones are ARM, the emulator x86_64.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        fcmConfig.forEach { (name, value) -> buildConfigField("String", name, "\"$value\"") }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "chineselearning"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.systemProperty("robolectric.pixelCopyRenderMode", "hardware") }
        }
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

roborazzi {
    outputDir.set(file("$projectDir/screenshots"))
}

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.work)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.okhttp)
    implementation(libs.zxing.core) // invite QR codes (ui/teaching)
    implementation(libs.webrtc) // video calls (ui/calls, data/calls): org.webrtc, Google's WebRTC built for Android
    implementation(libs.kotlinx.serialization.json)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging) // chat notifications (data/chat/), initialised by hand when configured
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.robolectric)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.androidx.work.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.compose.ui.test.manifest)
}
