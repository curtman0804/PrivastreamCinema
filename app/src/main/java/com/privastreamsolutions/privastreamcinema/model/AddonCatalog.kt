package com.privastreamsolutions.privastreamcinema.model

data class AddonCatalog(
    val name: String,      // Display name like "Netflix"
    val type: String,      // Content type like "movie" or "series"
    val id: String         // Catalog ID used to build the endpoint URL
)