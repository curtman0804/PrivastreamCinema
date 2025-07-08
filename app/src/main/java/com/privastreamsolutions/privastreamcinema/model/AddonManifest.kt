package com.privastreamsolutions.privastreamcinema.model

data class AddonManifest(
    val id: String,
    val name: String,
    val description: String?,
    val version: String?,
    val catalogs: List<Map<String, Any>>?,
    var addonUrl: String? = null
)