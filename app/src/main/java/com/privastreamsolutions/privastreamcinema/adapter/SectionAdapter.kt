package com.privastreamsolutions.privastreamcinema.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.FragmentActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem

class SectionAdapter(
    private var sections: Map<String, List<MediaItem>>,
    private val activity: FragmentActivity
) : RecyclerView.Adapter<SectionAdapter.SectionViewHolder>() {

    class SectionViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val innerList: RecyclerView = view.findViewById(R.id.sectionRecycler)
        val sectionTitle: androidx.appcompat.widget.AppCompatTextView =
            view.findViewById(R.id.sectionTitle)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SectionViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_section_row, parent, false)
        return SectionViewHolder(view)
    }

    override fun getItemCount(): Int = sections.size

    override fun onBindViewHolder(holder: SectionViewHolder, position: Int) {
        val keys = sections.keys.toList()
        val title = keys[position]
        val items = sections[title] ?: emptyList()

        holder.sectionTitle.text = title
        holder.innerList.layoutManager = LinearLayoutManager(
            activity, LinearLayoutManager.HORIZONTAL, false
        )
        holder.innerList.adapter = MediaAdapter(items, activity)
    }

    fun updateSections(newData: Map<String, List<MediaItem>>) {
        sections = newData
        notifyDataSetChanged()
    }
}