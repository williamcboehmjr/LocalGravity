import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "com.localgravity.client"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "com.localgravity.client"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    val keystoreProps = Properties().apply {
        val kpFile = file("../../../keystore.properties")
        if (kpFile.exists()) {
            kpFile.inputStream().use { load(it) }
        }
    }
    val releaseKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
        ?: file("../../../localgravity-android.keystore").takeIf { it.exists() }?.absolutePath
        ?: rootProject.file("localgravity-android.keystore").takeIf { it.exists() }?.absolutePath
    val releaseKeystorePass = System.getenv("ANDROID_KEYSTORE_PASS")
        ?: keystoreProps.getProperty("storePassword", "")
    val releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
        ?: keystoreProps.getProperty("keyAlias", "localgravity")
    val releaseKeyPass = System.getenv("ANDROID_KEY_PASS")
        ?: keystoreProps.getProperty("keyPassword", releaseKeystorePass)

    signingConfigs {
        if (releaseKeystorePath != null && releaseKeystorePass.isNotEmpty()) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseKeystorePass
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPass
            }
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = false
            isJniDebuggable = false
            if (signingConfigs.findByName("release") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
