package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.adapter.SectionAdapter
import kotlinx.coroutines.launch

class HomeFragment : Fragment() {

    private lateinit var sectionList: RecyclerView
    private lateinit var sectionAdapter: SectionAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        sectionList = view.findViewById(R.id.catalogSectionList)
        sectionAdapter = SectionAdapter(
            sections = emptyMap(),
            activity = requireActivity()
        )

        sectionList.layoutManager = LinearLayoutManager(requireContext())
        sectionList.adapter = sectionAdapter

        loadCatalogs()
    }

    private fun loadCatalogs() {
        lifecycleScope.launch {
            val sections = CatalogFetcher.fetchAllCatalogs()
            sectionAdapter.updateSections(sections)
        }
    }
}