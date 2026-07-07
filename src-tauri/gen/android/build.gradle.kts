buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

// Task aliases for Tauri CLI (it calls e.g. assembleArm64Debug which doesn't exist by default)
listOf("Arm64", "Armv7", "X86_64", "I686").forEach { arch ->
    tasks.register("assemble${arch}Debug") {
        dependsOn(":app:assembleDebug")
    }
    tasks.register("assemble${arch}Release") {
        dependsOn(":app:assembleRelease")
    }
}

