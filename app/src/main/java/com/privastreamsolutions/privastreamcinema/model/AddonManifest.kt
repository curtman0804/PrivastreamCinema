package com.privastreamsolutions.privastreamcinema.model

data class AddonManifest(
    val id: String,
    val name: String,
    val description: String?,
    val version: String?,
    var logo: String? = null,
    var catalogs: List<AddonCatalog>? = null,
    var addonUrl: String? = null,
    var catalogSections: List<CatalogSection>? = null
)