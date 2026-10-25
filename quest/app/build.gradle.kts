// The Moduli office on the Quest: passthrough, room anchors, and the office's
// shelves / screens / decor as real objects. The office's data and settings
// come from Moduli itself (a web panel at /?office, see client/src/vr/NativeOffice.jsx).
plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.jetbrains.kotlin.android)
  alias(libs.plugins.compose.compiler)
}

android {
  namespace = "com.viafluere.moduli.office"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.viafluere.moduli.office"
    minSdk = 34
    // HorizonOS is Android 14 (API level 34)
    targetSdk = 34
    versionCode = 1
    versionName = "0.1"
    // The Moduli site the office talks to.
    buildConfigField("String", "MODULI_URL", "\"https://viafluere.com\"")
  }

  packaging { resources.excludes.add("META-INF/LICENSE") }
  lint {
    abortOnError = false
    checkReleaseBuilds = false
  }
  buildTypes {
    release { isMinifyEnabled = false }
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.ui)
  implementation(libs.androidx.ui.graphics)
  implementation(libs.androidx.material3)

  implementation(libs.meta.spatial.sdk.base)
  implementation(libs.meta.spatial.sdk.compose)
  implementation(libs.meta.spatial.sdk.toolkit)
  implementation(libs.meta.spatial.sdk.vr)
  implementation(libs.meta.spatial.sdk.mruk)
  // Web-view settings the platform API lacks: drop the X-Requested-With header and set the client-hint brands (Google
  // refuses to sign in a browser it recognises as embedded in an app).
  implementation("androidx.webkit:webkit:1.12.1")
}
