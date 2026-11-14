---
trigger: always_on
---

# LocalGravity Release Build Rule

Whenever the user asks to **release** or **publish** a new version of LocalGravity:
1. Always build **Windows x64 MSI + updater signature** locally (`node scripts/build_signed_release.mjs`) and **Android ARM64 APK** locally:
   - Set `ANDROID_HOME=C:\Android\Sdk`, `NDK_HOME=C:\Android\Sdk\ndk\26.3.11579264`, `JAVA_HOME=C:\Program Files\Java\jdk-20`.
   - Build the Rust Android lib (`npx tauri android build --apk --target aarch64` in `client/`, or if Windows symlink permissions fail on `jniLibs\arm64-v8a\liblocalgravity_edge_lib.so`, copy `client\src-tauri\target\aarch64-linux-android\release\liblocalgravity_edge_lib.so` into `client\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblocalgravity_edge_lib.so` and run `.\gradlew.bat assembleArm64Release -x rustBuildArm64Release`).
   - Rename/copy `app-arm64-release.apk` to `LocalGravity_<version>_arm64.apk`.
2. Upload `LocalGravity_<version>_x64_en-US.msi`, `LocalGravity_<version>_x64_en-US.msi.sig`, and `LocalGravity_<version>_arm64.apk` to the GitHub Release via `gh release upload <tag> ... --clobber` alongside the GitHub Actions cross-platform builds (macOS Universal, Linux, Windows ARM64).
