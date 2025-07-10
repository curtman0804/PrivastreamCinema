package com.privastreamsolutions.privastreamcinema.model

data class CatalogSection(
    val label: String,     // "Popular – Movies"
    val type: String,      // "movie" or "series"
    val id: String         // catalog ID, e.g. "popular", "netflix"
)