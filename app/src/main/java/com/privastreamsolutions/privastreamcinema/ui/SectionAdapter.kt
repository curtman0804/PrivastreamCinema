package com.privastreamsolutions.privastreamcinema.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.CatalogEntry
import com.privastreamsolutions.privastreamcinema.model.CatalogSection

class SectionAdapter : RecyclerView.Adapter<SectionAdapter.SectionViewHolder>() {

    private val sections = mutableListOf<CatalogSection>()

    fun submitList(newList: List<CatalogSection>) {
        sections.clear()
        sections.addAll(newList)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SectionViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_catalog_section, parent, false)
        return SectionViewHolder(view)
    }

    override fun getItemCount(): Int = sections.size

    override fun onBindViewHolder(holder: SectionViewHolder, position: Int) {
        holder.bind(sections[position])
    }

    class SectionViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val sectionTitle = view.findViewById<TextView>(R.id.sectionTitle)
        private val posterList = view.findViewById<RecyclerView>(R.id.posterRecycler)

        fun bind(section: CatalogSection) {
            sectionTitle.text = section.title
            posterList.layoutManager =
                LinearLayoutManager(itemView.context, LinearLayoutManager.HORIZONTAL, false)
            posterList.adapter = PosterAdapter(section.entries)
        }
    }
}