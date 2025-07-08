package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.launch

class HomeFragment : Fragment(R.layout.fragment_home) {

    private lateinit var catalogList: RecyclerView
    private val sectionAdapter = SectionAdapter()

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        catalogList = view.findViewById(R.id.catalogList)
        catalogList.layoutManager = LinearLayoutManager(requireContext())
        catalogList.adapter = sectionAdapter

        loadAllCatalogs()
    }

    private fun loadAllCatalogs() {
        val addons: List<AddonManifest> = InstalledAddons.getAll()
        lifecycleScope.launch {
            val sections = CatalogFetcher.fetchAllSections(addons)
            Log.d("HomeFragment", "Catalog sections loaded: ${sections.size}")
            sectionAdapter.submitList(sections)
        }
    }
}