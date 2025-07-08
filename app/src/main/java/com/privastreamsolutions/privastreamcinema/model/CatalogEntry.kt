package com.privastreamsolutions.privastreamcinema.model

data class CatalogEntry(
    val id: String,
    val name: String,
    val poster: String?,
    val description: String?,
    val type: String
)