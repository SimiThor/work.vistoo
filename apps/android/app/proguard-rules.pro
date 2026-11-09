# kotlinx.serialization: keep generated serializers of the contract models.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class de.vistoo.work.core.generated.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class de.vistoo.work.core.generated.**$$serializer { *; }
-keepclasseswithmembers class de.vistoo.work.core.generated.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Navigation routes are @Serializable objects/classes.
-keep @kotlinx.serialization.Serializable class de.vistoo.work.ui.** { *; }
# OkHttp
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
